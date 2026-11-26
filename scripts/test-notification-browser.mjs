// Real production frontend + actual local API/Prisma/E1-E3 transactions.
// Invoked only by the isolated PostgreSQL runner; never visits production.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createDatabaseClient } from '../apps/api/src/db/client.ts';
import { createApp } from '../apps/api/src/app.ts';
import { createAuthService } from '../apps/api/src/modules/auth/service.ts';
import { createWatchlistService } from '../apps/api/src/modules/watchlists/service.ts';
import { createNotificationService } from '../apps/api/src/modules/notifications/service.ts';

const raw = process.env.TEST_DATABASE_URL;
if (!raw) throw new Error('Isolated TEST_DATABASE_URL required');
const target = new URL(raw);
if (
  target.protocol !== 'postgresql:' ||
  target.hostname !== '127.0.0.1' ||
  target.pathname !== '/marketpulse_test' ||
  target.search ||
  target.hash ||
  process.env.DATABASE_URL !== raw ||
  process.env.NODE_ENV !== 'test'
)
  throw new Error('Browser tests require the isolated loopback test runner');
const db = createDatabaseClient(raw);
const artifacts = await mkdtemp(
  join(tmpdir(), 'marketpulse-notifications-browser-'),
);
const emails = [0, 1].map(() => `${randomUUID()}@e4.test`);
const config = {
  origin: '',
  secret: 'a'.repeat(64),
  secure: false,
  ttlSeconds: 3600,
};
const messages = [];
const fixtureAssets = [];
const auth = createAuthService(db, config, {
  enabled: true,
  async send(message) {
    messages.push(message);
  },
});
const api = createApp(
  auth,
  config,
  undefined,
  createWatchlistService(db),
  undefined,
  { notifications: createNotificationService(db, config.secret) },
);
const wrapper = express();
let fault = null;
const writes = [];
let gateCsrf = false;
let activeCsrf = 0;
let maximumCsrf = 0;
let gatedCsrf = 0;
wrapper.use(async (req, res, next) => {
  if (gateCsrf && req.path === '/api/v1/auth/csrf') {
    res.json = (body) => {
      activeCsrf++;
      gatedCsrf++;
      maximumCsrf = Math.max(maximumCsrf, activeCsrf);
      // Install the real CSRF cookie headers, delay its JSON body. Concurrent
      // issuances would overwrite the first cookie before its client can write.
      res.type('json');
      res.flushHeaders();
      setTimeout(() => {
        activeCsrf--;
        res.end(JSON.stringify(body));
      }, 100);
      return res;
    };
  }

  if (req.path.startsWith('/api/') && !['GET', 'HEAD'].includes(req.method))
    writes.push({ path: req.path, method: req.method });
  if (fault && req.method === fault.method && req.path === fault.path) {
    const once = fault;
    fault = null;
    if (once.delay) await new Promise((done) => setTimeout(done, once.delay));
    else {
      res.status(once.status).json({ error: once.message });
      return;
    }
  }
  if (req.path.startsWith('/api/')) api(req, res, next);
  else next();
});
wrapper.use(express.static(resolve('apps/web/dist')));
wrapper.use((_req, res) => res.sendFile(resolve('apps/web/dist/index.html')));
const server = wrapper.listen(0, '127.0.0.1');
await new Promise((done) => server.once('listening', done));
config.origin = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn(
  process.env.CHROME_BIN ?? '/usr/bin/google-chrome',
  [
    '--headless',
    '--no-sandbox',
    '--remote-debugging-pipe',
    `--user-data-dir=${artifacts}/profile`,
    '--disable-background-networking',
    '--no-first-run',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
);
let sequence = 0,
  buffer = '';
const pending = new Map(),
  exceptions = [],
  results = [];
function send(method, params = {}, sessionId) {
  return new Promise((resolvePromise, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Browser timeout: ${method}`));
    }, 15_000);
    pending.set(id, { resolve: resolvePromise, reject, timer });
    chrome.stdio[3].write(
      JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }) + '\0',
    );
  });
}
chrome.stdio[4].on('data', (chunk) => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    const waiter = pending.get(message.id);
    if (waiter) {
      clearTimeout(waiter.timer);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown')
      exceptions.push(message.params.exceptionDetails.text);
  }
});
const deadline = setTimeout(() => {
  chrome.kill('SIGKILL');
  server.close();
  process.exitCode = 1;
}, 180_000);
try {
  const target = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  const evaluate = async (expression) => {
    const response = await send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      sessionId,
    );
    if (response.exceptionDetails)
      throw new Error(
        response.exceptionDetails.text +
          ': ' +
          response.exceptionDetails.exception?.description,
      );
    return response.result.value;
  };
  async function until(expression) {
    for (let i = 0; i < 300; i++) {
      if (await evaluate(expression)) return;
      await new Promise((done) => setTimeout(done, 50));
    }
    throw new Error(`Condition timed out: ${expression}`);
  }
  const navigate = (path) =>
    send('Page.navigate', { url: config.origin + path }, sessionId);
  const click = (text) =>
    evaluate(
      `(()=>{const button=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!button)throw Error('Missing button');button.click();})()`,
    );
  async function input(selector, text) {
    await evaluate(
      `(()=>{const input=document.querySelector(${JSON.stringify(selector)});input.focus();input.select();})()`,
    );
    await send('Input.insertText', { text }, sessionId);
  }
  async function ready() {
    await until(
      "!!document.querySelector('.notification-list') || !!document.querySelector('.notification-empty h2')",
    );
  }
  async function visible(selector) {
    return evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect(),s=getComputedStyle(e);const hit=document.elementFromPoint(b.left+b.width/2,b.top+b.height/2);return b.width>0&&b.height>0&&b.left>=0&&b.right<=innerWidth+1&&b.top>=0&&b.bottom<=innerHeight+1&&s.visibility==='visible'&&s.display!=='none'&&!!hit&&(e.contains(hit)||hit.contains(e));})()`,
    );
  }
  await navigate('/notifications');
  await until(
    "location.pathname==='/login' && !!document.querySelector('input[name=email]')",
  );
  assert.equal(
    await evaluate("document.querySelector('.notification-bell')===null"),
    true,
  );
  results.push('Guests redirect to sign-in with no private badge/history');
  await navigate('/register');
  await until("!!document.querySelector('input[name=displayName]')");
  await input('input[name=displayName]', 'E4 Local Browser');
  await input('input[name=email]', emails[0]);
  await input('input[name=password]', 'a secure local browser passphrase');
  await evaluate("document.querySelector('form button').click()");
  await until(
    "location.pathname==='/account' && !!document.querySelector('.notification-badge')",
  );
  await evaluate("document.querySelector('.notification-bell').focus()");
  await send(
    'Input.dispatchKeyEvent',
    { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
    sessionId,
  );
  await send(
    'Input.dispatchKeyEvent',
    { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
    sessionId,
  );
  await ready();
  assert.equal(
    await evaluate(
      "document.querySelector('.notification-message').textContent",
    ),
    'Your MarketPulse account was created.',
  );
  assert.equal(await visible('.notification-bell'), true);
  results.push(
    'Keyboard bell navigation and genuine registration event reach the real API',
  );
  const user = await db.user.findUniqueOrThrow({ where: { email: emails[0] } });
  // Seed history through real, CSRF-protected business APIs, not notification inserts.
  await evaluate(
    `(async()=>{window.e4write=async(path,method,body)=>{const {csrfToken}=await fetch('/api/v1/auth/csrf').then(r=>r.json());const r=await fetch('/api/v1'+path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify(body)});if(!r.ok)throw Error('Business API failed '+r.status);return r.status===204?null:r.json();};const {watchlist}=await window.e4write('/watchlists','POST',{name:'E4 initial list'});window.e4list=watchlist.id;for(let i=0;i<22;i++)await window.e4write('/watchlists/'+watchlist.id,'PATCH',{name:'E4 actual rename '+i});})()`,
  );
  await click('Refresh');
  await ready();
  await until("document.querySelectorAll('.notification-item').length===20");
  fault = {
    method: 'GET',
    path: '/api/v1/notifications',
    status: 503,
    message: 'Older notifications temporarily unavailable',
  };
  await click('Load more notifications');
  await until(
    "document.querySelector('[role=alert]')?.textContent.includes('Older notifications')",
  );
  assert.equal(
    await evaluate("document.querySelectorAll('.notification-item').length"),
    20,
  );
  await click('Try again');
  await until("document.querySelectorAll('.notification-item').length===24");
  assert.equal(
    await evaluate(
      "new Set([...document.querySelectorAll('.notification-item')].map(e=>e.querySelector('time').dateTime+e.textContent)).size>0",
    ),
    true,
  );
  results.push(
    'Cursor pagination loads 24 genuine events without inventing history',
  );
  fault = {
    method: 'PATCH',
    path: `/api/v1/notifications/${(await db.notification.findFirstOrThrow({ where: { userId: user.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })).id}/read`,
    delay: 500,
  };
  await click('Mark as read');
  await until("!!document.querySelector('.notification-item button:disabled')");
  await until(
    "document.querySelector('[role=status]').textContent.includes('marked as read')",
  );
  await ready();
  assert.equal(
    await db.notification.count({
      where: { userId: user.id, readAt: { not: null } },
    }),
    1,
  );
  await click('Read');
  await ready();
  await until("document.querySelectorAll('.notification-item').length===1");
  await click('Mark as unread');
  await ready();
  await until(
    "document.querySelector('.notification-empty h2')?.textContent==='No read notifications.'",
  );
  await click('Unread');
  await ready();
  await click('Mark all as read');
  await ready();
  await until(
    "document.querySelector('.notification-empty h2')?.textContent==='No unread notifications.'",
  );
  await until(
    "document.querySelector('.notification-bell')?.getAttribute('aria-label')==='Notifications — 0 unread'",
  );
  assert.equal(
    await db.notification.count({ where: { userId: user.id, readAt: null } }),
    0,
  );
  results.push(
    'Read/unread, read filter, mark-all, disabled busy controls and badge stay consistent with PostgreSQL',
  );
  await evaluate(
    "document.querySelectorAll('.notification-preferences input')[1].click()",
  );
  await click('Save preferences');
  await until(
    "document.querySelector('[role=status]').textContent.includes('preferences saved')",
  );
  assert.equal(
    (
      await db.notificationPreference.findUniqueOrThrow({
        where: { userId: user.id },
      })
    ).watchlistActivityEnabled,
    false,
  );
  const before = await db.notification.count({ where: { userId: user.id } });
  await evaluate(
    "window.e4write('/watchlists/'+window.e4list,'PATCH',{name:'Suppressed genuine rename'})",
  );
  assert.equal(
    await db.notification.count({ where: { userId: user.id } }),
    before,
  );
  await navigate('/notifications');
  await ready();
  await until("!!document.querySelector('.notification-preferences input')");
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.notification-preferences input')[1].checked",
    ),
    false,
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.notification-security').textContent.includes('always stay on')",
    ),
    true,
  );
  results.push(
    'Preferences persist, suppress future optional events and retain mandatory security disclosure',
  );
  await click('All');
  await ready();
  for (const [width, height] of [
    [1440, 1000],
    [768, 1024],
    [390, 844],
    [320, 740],
  ]) {
    await send(
      'Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    for (const theme of ['dark', 'light']) {
      const current = await evaluate('document.documentElement.dataset.theme');
      if (current !== theme)
        await evaluate("document.querySelector('.theme-toggle').click()");
      await until(`document.documentElement.dataset.theme==='${theme}'`);
      assert.equal(
        await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),
        true,
        `${width} horizontal overflow`,
      );
      for (const selector of [
        '.notification-bell',
        '.notification-item .secondary-button',
        '.notification-action-link',
        '.notification-security',
        '.notification-preferences .primary-button',
      ])
        assert.equal(
          await visible(selector),
          true,
          `${width} ${theme} ${selector} visibility`,
        );
      const contrast = await evaluate(
        `(()=>{function rgb(s){return s.match(/[0-9.]+/g).slice(0,3).map(Number)}function lum(c){return rgb(c).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0)}const e=document.querySelector('.notification-read-state');let b=e;while(b&&getComputedStyle(b).backgroundColor==='rgba(0, 0, 0, 0)')b=b.parentElement;const a=lum(getComputedStyle(e).color),c=lum(getComputedStyle(b).backgroundColor);return (Math.max(a,c)+.05)/(Math.min(a,c)+.05)})()`,
      );
      assert.ok(
        contrast >= 4.5,
        `${width} ${theme} read-state contrast ${contrast}`,
      );
      await evaluate('scrollTo(0,0)');
      const shot = await send(
        'Page.captureScreenshot',
        { format: 'png', captureBeyondViewport: true },
        sessionId,
      );
      await writeFile(
        join(artifacts, `${width}-${theme}.png`),
        Buffer.from(shot.data, 'base64'),
      );
      results.push(
        `${width}px ${theme}: no overflow, controls/links/disclosures hit-tested visible, text contrast passes`,
      );
    }
  }
  // Fault injection returns controlled HTTP errors, never fake notification rows.
  fault = {
    method: 'GET',
    path: '/api/v1/notifications',
    status: 503,
    message: 'History temporarily unavailable',
  };
  await click('Refresh');
  await until("!!document.querySelector('[role=alert]')");
  assert.equal(
    await evaluate("document.querySelector('.notification-list')===null"),
    true,
  );
  await click('Try again');
  await ready();
  fault = {
    method: 'GET',
    path: '/api/v1/notifications',
    status: 429,
    message: 'Too many requests. Try again later.',
  };
  await click('Refresh');
  await until(
    "document.querySelector('[role=alert]')?.textContent.includes('Too many requests')",
  );
  await click('Try again');
  await ready();
  results.push(
    '503 and 429 history failures display actionable errors, never false empty state, and retry recovers',
  );
  fault = {
    method: 'GET',
    path: '/api/v1/notifications/summary',
    status: 503,
    message: 'Summary unavailable',
  };
  await click('Refresh');
  await until(
    "document.querySelector('[role=alert]')?.textContent.includes('Could not load your inbox')",
  );
  assert.equal(
    await evaluate(
      "!document.querySelector('.notification-list')&&!document.querySelector('.notification-badge')",
    ),
    true,
  );
  await click('Try again');
  await ready();
  fault = {
    method: 'GET',
    path: '/api/v1/notifications/preferences',
    status: 503,
    message: 'Preferences unavailable',
  };
  await navigate('/notifications');
  await ready();
  await until(
    "document.querySelector('.notification-preferences [role=alert]')?.textContent.includes('Preferences unavailable')",
  );
  await click('Try again');
  await until("!!document.querySelector('.notification-preferences input')");
  results.push(
    'Summary and preferences loading failures remain distinct from empty data and recover on retry',
  );

  fault = {
    method: 'PATCH',
    path: '/api/v1/notifications/preferences',
    status: 503,
    message: 'Save temporarily unavailable',
  };
  await evaluate(
    "document.querySelectorAll('.notification-preferences input')[1].click()",
  );
  await click('Save preferences');
  await until(
    "document.querySelector('[role=alert]')?.textContent.includes('Save temporarily unavailable')",
  );
  assert.equal(
    (
      await db.notificationPreference.findUniqueOrThrow({
        where: { userId: user.id },
      })
    ).watchlistActivityEnabled,
    false,
  );
  await click('Save preferences');
  await until(
    "document.querySelector('[role=status]').textContent.includes('preferences saved')",
  );
  results.push(
    'Failed preference writes keep draft values, do not claim success and can be retried',
  );
  const listForLifecycle = await db.watchlist.findFirstOrThrow({
    where: { userId: user.id },
  });
  const catalogFixture = await db.asset.create({
    data: {
      key: `crypto:e5-browser:${randomUUID()}`,
      symbol: 'BTC',
      name: 'Bitcoin',
      type: 'CRYPTO',
      isDemoOnly: false,
    },
  });
  fixtureAssets.push(catalogFixture.id);
  await evaluate(
    `(async()=>{const write=async(path,method,body)=>{const {csrfToken}=await fetch('/api/v1/auth/csrf').then(r=>r.json());const r=await fetch('/api/v1'+path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('Lifecycle action failed '+r.status);};const list=${JSON.stringify(listForLifecycle.id)},asset=${JSON.stringify(catalogFixture.id)};await write('/watchlists/'+list+'/items','POST',{assetId:asset});await write('/watchlists/'+list+'/items','POST',{assetId:asset});await write('/watchlists/'+list+'/items/'+asset,'DELETE');await write('/watchlists/'+list+'/items/'+asset,'DELETE');await write('/watchlists/'+list,'DELETE');})()`,
  );
  for (const kind of [
    'WATCHLIST_ASSET_ADDED',
    'WATCHLIST_ASSET_REMOVED',
    'WATCHLIST_DELETED',
  ])
    assert.equal(
      await db.notification.count({ where: { userId: user.id, kind } }),
      1,
    );
  await navigate('/notifications');
  await ready();
  await click('Load more notifications');
  await until("document.querySelectorAll('.notification-item').length===27");
  assert.equal(
    await evaluate(
      "[...document.querySelectorAll('.notification-action-link')].filter(e=>e.textContent==='View watchlists').every(e=>e.getAttribute('href')==='/watchlists')",
    ),
    true,
  );
  results.push(
    'All five genuine watchlist event types reach the inbox; duplicate adds/removes emit nothing and deleted subjects use safe fallback links',
  );
  const peerTarget = await send('Target.createTarget', {
    url: config.origin + '/notifications',
  });
  const { sessionId: peerId } = await send('Target.attachToTarget', {
    targetId: peerTarget.targetId,
    flatten: true,
  });
  await send('Runtime.enable', {}, peerId);
  const peerValue = async (expression) =>
    (
      await send(
        'Runtime.evaluate',
        { expression, returnByValue: true },
        peerId,
      )
    ).result.value;
  for (
    let i = 0;
    i < 200 &&
    !(await peerValue(
      "document.querySelectorAll('.notification-item').length===20",
    ));
    i++
  )
    await new Promise((done) => setTimeout(done, 50));
  assert.equal(
    await peerValue("document.querySelectorAll('.notification-item').length"),
    20,
  );
  await send('Page.bringToFront', {}, sessionId);
  await navigate('/register');
  await until("!!document.querySelector('input[name=displayName]')");
  await input('input[name=displayName]', 'Second E4 Browser Account');
  await input('input[name=email]', emails[1]);
  await input(
    'input[name=password]',
    'another secure local browser passphrase',
  );
  await evaluate("document.querySelector('form button').click()");
  await until("location.pathname==='/account'");
  for (
    let i = 0;
    i < 200 &&
    !(await peerValue(
      "document.querySelectorAll('.notification-item').length===1",
    ));
    i++
  )
    await new Promise((done) => setTimeout(done, 50));
  assert.equal(
    await peerValue("document.querySelectorAll('.notification-item').length"),
    1,
  );
  assert.equal(
    await peerValue(
      "document.querySelector('.notification-message').textContent",
    ),
    'Your MarketPulse account was created.',
  );
  results.push(
    'Cross-tab account replacement discards the old account history and displays only the new inbox',
  );
  await navigate('/notifications');
  await ready();
  await until("!!document.querySelector('.notification-preferences input')");
  await evaluate(
    "document.querySelectorAll('.notification-preferences input')[0].click()",
  );
  await peerValue(
    "document.querySelectorAll('.notification-preferences input')[1].click()",
  );
  gateCsrf = true;
  await Promise.all([
    click('Save preferences'),
    peerValue(
      "[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Save preferences').click()",
    ),
  ]);
  await until(
    "document.querySelector('[role=status]').textContent.includes('preferences saved')",
  );
  for (
    let i = 0;
    i < 200 &&
    !(await peerValue(
      "document.querySelector('[role=status]')?.textContent.includes('preferences saved')",
    ));
    i++
  )
    await new Promise((done) => setTimeout(done, 50));
  assert.equal(
    await peerValue(
      "document.querySelector('[role=status]').textContent.includes('preferences saved')",
    ),
    true,
  );
  gateCsrf = false;
  assert.equal(gatedCsrf, 2);
  assert.equal(
    maximumCsrf,
    1,
    'CSRF issuance and writes must be serialized across tabs',
  );
  const mergedPreferences = await db.notificationPreference.findUniqueOrThrow({
    where: {
      userId: (await db.user.findUniqueOrThrow({ where: { email: emails[1] } }))
        .id,
    },
  });
  assert.equal(mergedPreferences.accountActivityEnabled, false);
  assert.equal(
    mergedPreferences.watchlistActivityEnabled,
    false,
    'Saving one field must not overwrite another tab’s field',
  );
  results.push(
    'Concurrent cross-tab preference saves preserve both intents and use intact real CSRF cookie/header pairs',
  );
  await send('Target.closeTarget', { targetId: peerTarget.targetId });
  await navigate('/notifications');
  await ready();
  const currentUser = await db.user.findUniqueOrThrow({
    where: { email: emails[1] },
  });
  // Re-read both preferences after concurrent edits, restore optional notifications
  // through the real UI, then cover every account event with a local-only mailer.
  await until("!!document.querySelector('.notification-preferences input')");
  await evaluate(
    "document.querySelectorAll('.notification-preferences input')[0].click();document.querySelectorAll('.notification-preferences input')[1].click()",
  );
  await click('Save preferences');
  await until(
    "document.querySelector('[role=status]').textContent.includes('preferences saved')",
  );
  await navigate('/login');
  await until("!!document.querySelector('input[name=email]')");
  await input('input[name=email]', emails[1]);
  await input('input[name=password]', 'incorrect test password');
  await click('Sign in');
  await until(
    "document.querySelector('[role=alert]')?.textContent.includes('Invalid email or password')",
  );
  assert.equal(
    await db.notification.count({
      where: { userId: currentUser.id, kind: 'SIGNED_IN' },
    }),
    0,
  );
  await input(
    'input[name=password]',
    'another secure local browser passphrase',
  );
  await click('Sign in');
  await until(
    "location.pathname==='/account'&&document.querySelector('h1')?.textContent==='Your account'",
  );
  assert.equal(
    await db.notification.count({
      where: { userId: currentUser.id, kind: 'SIGNED_IN' },
    }),
    1,
  );
  await click('Send verification link');
  await until(
    "document.querySelector('[role=status]')?.textContent.includes('Verification email requested')",
  );
  const verification = messages
    .filter(
      (message) =>
        message.to === emails[1] && message.subject.includes('Verify'),
    )
    .at(-1)
    ?.text.match(/#token=([a-f0-9]{64})/)?.[1];
  assert.ok(
    verification,
    'Local capture received the actual verification link',
  );
  await navigate('/verify-email#token=' + verification);
  await until(
    "!![...document.querySelectorAll('button')].find(e=>e.textContent==='Verify email'&&!e.disabled)",
  );
  assert.equal(await evaluate("location.hash===''"), true);
  await click('Verify email');
  await until(
    "document.querySelector('[role=status]')?.textContent==='Email verified.'",
  );
  assert.equal(
    await db.notification.count({
      where: { userId: currentUser.id, kind: 'EMAIL_VERIFIED' },
    }),
    1,
  );
  await navigate('/verify-email#token=' + verification);
  await until(
    "!![...document.querySelectorAll('button')].find(e=>e.textContent==='Verify email'&&!e.disabled)",
  );
  await click('Verify email');
  await until(
    "document.querySelector('[role=alert]')?.textContent.includes('Invalid or expired')",
  );
  assert.equal(
    await db.notification.count({
      where: { userId: currentUser.id, kind: 'EMAIL_VERIFIED' },
    }),
    1,
  );
  await navigate('/account');
  await until(
    "!![...document.querySelectorAll('button')].find(e=>e.textContent==='Revoke')",
  );
  await click('Revoke');
  await until("location.pathname==='/login'");
  assert.equal(
    await db.session.count({
      where: {
        userId: currentUser.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    }),
    0,
  );
  assert.equal(
    await db.notification.count({
      where: { userId: currentUser.id, kind: 'SESSION_REVOKED' },
    }),
    2,
  ); // Login rotation, then explicit revocation.
  await input('input[name=email]', emails[1]);
  await input(
    'input[name=password]',
    'another secure local browser passphrase',
  );
  await click('Sign in');
  await until("location.pathname==='/account'");
  await navigate('/forgot-password');
  await until("!!document.querySelector('input[name=email]')");
  await input('input[name=email]', emails[1]);
  await click('Request reset link');
  await until(
    "document.querySelector('[role=status]')?.textContent.includes('If the account exists')",
  );
  assert.equal(
    await db.notification.count({
      where: { userId: currentUser.id, kind: 'PASSWORD_RESET' },
    }),
    0,
  );
  const reset = messages
    .filter(
      (message) =>
        message.to === emails[1] && message.subject.includes('Reset'),
    )
    .at(-1)
    ?.text.match(/#token=([a-f0-9]{64})/)?.[1];
  assert.ok(reset, 'Local capture received the actual password reset link');
  await navigate('/reset-password#token=' + reset);
  await until("!!document.querySelector('input[name=password]')");
  assert.equal(await evaluate("location.hash===''"), true);
  await input(
    'input[name=password]',
    'the replacement local browser passphrase',
  );
  await click('Reset password');
  await until(
    "document.querySelector('[role=status]')?.textContent.includes('Password reset. Sign in again.')",
  );
  assert.equal(
    await db.notification.count({
      where: { userId: currentUser.id, kind: 'PASSWORD_RESET' },
    }),
    1,
  );
  assert.equal(
    await db.session.count({
      where: { userId: currentUser.id, revokedAt: null },
    }),
    0,
  );
  await navigate('/reset-password#token=' + reset);
  await until("!!document.querySelector('input[name=password]')");
  await input('input[name=password]', 'should never become a password');
  await click('Reset password');
  await until(
    "document.querySelector('[role=alert]')?.textContent.includes('Invalid or expired')",
  );
  assert.equal(
    await db.notification.count({
      where: { userId: currentUser.id, kind: 'PASSWORD_RESET' },
    }),
    1,
  );
  await navigate('/login');
  await until("!!document.querySelector('input[name=email]')");
  await input('input[name=email]', emails[1]);
  await input(
    'input[name=password]',
    'another secure local browser passphrase',
  );
  await click('Sign in');
  await until(
    "document.querySelector('[role=alert]')?.textContent.includes('Invalid email or password')",
  );
  await input(
    'input[name=password]',
    'the replacement local browser passphrase',
  );
  await click('Sign in');
  await until("location.pathname==='/account'");
  await navigate('/notifications');
  await ready();
  for (const title of [
    'Account created',
    'Signed in',
    'Session security',
    'Email verified',
    'Password reset',
  ])
    assert.equal(
      await evaluate(
        `[...document.querySelectorAll('.notification-meta strong')].some(e=>e.textContent===${JSON.stringify(title)})`,
      ),
      true,
    );
  results.push(
    'Real login, verification, session revocation and password-reset UI workflows produce owned account events; failed credentials and replayed tokens produce none',
  );
  await navigate('/account');
  await until(
    "!![...document.querySelectorAll('button')].find(e=>e.textContent==='Sign out')",
  );
  const revocations = await db.notification.count({
    where: { userId: currentUser.id, kind: 'SESSION_REVOKED' },
  });
  await click('Sign out');
  await until("location.pathname==='/login'");
  assert.equal(
    await db.notification.count({
      where: { userId: currentUser.id, kind: 'SESSION_REVOKED' },
    }),
    revocations + 1,
  );
  await input('input[name=email]', emails[1]);
  await input(
    'input[name=password]',
    'the replacement local browser passphrase',
  );
  await click('Sign in');
  await until("location.pathname==='/account'");
  await navigate('/notifications');
  await ready();
  results.push(
    'Signing out creates one genuine revocation event and removes private UI; subsequent login restores only the current inbox',
  );
  await db.session.updateMany({
    where: { userId: currentUser.id },
    data: { expiresAt: new Date(0) },
  });
  await click('Refresh');
  await until("location.pathname==='/login'");
  assert.equal(
    await evaluate(
      "!document.querySelector('.notification-list')&&!document.querySelector('.notification-badge')",
    ),
    true,
  );
  results.push(
    'Expired real sessions remove private history/count and redirect to sign-in',
  );
  assert.deepEqual(exceptions, []);
  assert.ok(
    writes.some((row) => row.path === '/api/v1/notifications/read-all'),
  );
  console.log(
    JSON.stringify(
      {
        results,
        exceptions,
        artifacts,
        limitation:
          'Local browser and real isolated API/database only. Controlled HTTP failures are injected locally; no production deployment, provider verification or external SMTP delivery; account links use an in-memory local mail transport.',
      },
      null,
      2,
    ),
  );
} finally {
  clearTimeout(deadline);
  await send('Browser.close').catch(() => {});
  chrome.kill('SIGTERM');
  await new Promise((done) => {
    server.closeAllConnections();
    server.close(done);
  });
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.asset.deleteMany({ where: { id: { in: fixtureAssets } } });
  await db.$disconnect();
}
