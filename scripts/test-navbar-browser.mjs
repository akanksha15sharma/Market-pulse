// Isolated browser regression: built frontend and synthetic sessions only.
// No production requests, real accounts, database, or third-party widgets.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
const root = resolve('apps/web/dist');
const artifacts = await mkdtemp(join(tmpdir(), 'marketpulse-navbar-'));
let signedIn = true,
  failLogout = false;
const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'user@example.test',
  displayName: 'Browser Test',
  emailVerified: true,
};
const writes = [];
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');
    let body = {};
    if (path.endsWith('/csrf')) body = { csrfToken: 'isolated-token' };
    else if (path.endsWith('/logout')) {
      writes.push({ path, csrf: req.headers['x-csrf-token'] });
      if (failLogout) {
        res.statusCode = 503;
        body = { error: 'Temporary sign-out failure' };
      } else {
        signedIn = false;
        res.statusCode = 204;
      }
    } else if (!signedIn) {
      res.statusCode = 401;
      body = { error: 'Sign in' };
    } else if (path.endsWith('/me')) body = { user };
    else if (path.endsWith('/summary'))
      body = { enabled: false, unreadCount: null };
    else if (path.endsWith('/sessions')) body = { sessions: [] };
    else if (path.endsWith('/assets')) body = { assets: [], total: 0 };
    res.end(JSON.stringify(body));
    return;
  }
  let file = resolve(root, '.' + path);
  if (!file.startsWith(root + '/')) file = join(root, 'index.html');
  let data;
  try {
    data = await readFile(file);
  } catch {
    file = join(root, 'index.html');
    data = await readFile(file);
  }
  res.setHeader(
    'Content-Type',
    { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[
      extname(file)
    ] ?? 'application/octet-stream',
  );
  res.end(data);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = spawn(
  process.env.CHROME_BIN ?? '/usr/bin/google-chrome',
  [
    '--headless',
    '--no-sandbox',
    '--remote-debugging-pipe',
    `--user-data-dir=${artifacts}/profile`,
    '--no-first-run',
    '--disable-background-networking',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
);
let sequence = 0,
  buffer = '';
const pending = new Map(),
  exceptions = [];
function send(method, params = {}, sessionId) {
  return new Promise((resolvePromise, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Browser timeout: ${method}`));
    }, 15000);
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
    const raw = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!raw) continue;
    const message = JSON.parse(raw);
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
}, 120_000);
try {
  const target = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Network.enable', {}, sessionId);
  await send('Network.setBlockedURLs', { urls: ['https://*'] }, sessionId);
  const evaluate = async (expression) => {
    const result = await send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true },
      sessionId,
    );
    if (result.exceptionDetails)
      throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  async function until(expression) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise((done) => setTimeout(done, 50));
    }
    throw new Error(`Browser condition failed: ${expression}`);
  }
  async function click(selector) {
    const point = await evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const r = el.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`,
    );
    await send(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', button: 'left', clickCount: 1, ...point },
      sessionId,
    );
    await send(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', button: 'left', clickCount: 1, ...point },
      sessionId,
    );
  }
  async function visible(selector) {
    assert.equal(
      await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el || !el.checkVisibility()) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight) return false;
      const hit = document.elementFromPoint(r.x+r.width/2, r.y+r.height/2);
      return el === hit || el.contains(hit);
    })()`),
      true,
      `Actually visible: ${selector}`,
    );
  }
  async function contrast(selector) {
    // Measure settled colors after the 150ms theme/hover transition.
    await new Promise((done) => setTimeout(done, 200));
    const ratio = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const rgb = c => c.match(/[\\d.]+/g).slice(0,3).map(Number);
      const luminance = c => rgb(c).map(v => {v/=255; return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[0.2126,0.7152,0.0722][i],0);
      let parent = el;
      while (parent && getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)') parent=parent.parentElement;
      const fg = luminance(getComputedStyle(el).color), bg=luminance(getComputedStyle(parent).backgroundColor);
      return (Math.max(fg,bg)+0.05)/(Math.min(fg,bg)+0.05);
    })()`);
    assert.ok(
      ratio >= 4.5,
      `${selector} contrast ${ratio}; ${await evaluate(`JSON.stringify({theme:document.documentElement.dataset.theme,width:innerWidth,color:getComputedStyle(document.querySelector(${JSON.stringify(selector)})).color,bg:getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor,panel:getComputedStyle(document.querySelector('.profile-panel')).backgroundColor})`)}`,
    );
  }
  const results = [];
  for (const width of [1440, 1280, 1024, 768, 375, 320]) {
    await send(
      'Emulation.setDeviceMetricsOverride',
      { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 },
      sessionId,
    );
    for (const theme of ['dark', 'light']) {
      await send('Page.navigate', { url: `${origin}/account` }, sessionId);
      await until("!!document.querySelector('.profile-trigger')");
      await evaluate(
        `localStorage.setItem('marketpulse-theme', ${JSON.stringify(theme)}); window.dispatchEvent(new Event('marketpulse-theme'));`,
      );
      await until(
        `document.documentElement.dataset.theme === ${JSON.stringify(theme)}`,
      );
      await visible('.nav-brand');
      await visible('.theme-toggle');
      assert.equal(
        await evaluate("!!document.querySelector('.theme-toggle svg')"),
        true,
      );
      assert.match(
        await evaluate(
          "document.querySelector('.theme-toggle').getAttribute('aria-label')",
        ),
        new RegExp(theme === 'dark' ? 'light' : 'dark'),
      );
      if (width < 1024) {
        assert.equal(
          await evaluate(
            "document.querySelector('#primary-navigation').checkVisibility()",
          ),
          false,
        );
        await visible('.mobile-nav-toggle');
        await click('.mobile-nav-toggle');
        await until(
          "document.querySelector('.mobile-nav-toggle').getAttribute('aria-expanded') === 'true'",
        );
      }
      await visible('.nav-link');
      await visible('.nav-link[href="/watchlists"]');
      await visible('.nav-link[href="/alerts"]');
      if (width >= 1024) {
        const placement = await evaluate(`(() => {
          const box = selector => document.querySelector(selector).getBoundingClientRect();
          const brand = box('.nav-brand'), links = box('.nav-primary-links'), tools = box('.theme-toggle'), notifications = box('.notification-bell'), profile = box('.profile-trigger');
          return {centerError: Math.abs((links.left + links.right) / 2 - document.documentElement.clientWidth / 2), ordered: brand.right <= links.left && links.right <= tools.left && tools.right <= notifications.left && notifications.right <= profile.left};
        })()`);
        assert.ok(
          placement.centerError <= 2,
          `Desktop links are centered: ${JSON.stringify(placement)}`,
        );
        assert.equal(
          placement.ordered,
          true,
          'Logo, center navigation, theme, notifications and profile do not overlap',
        );
      }
      await visible('.profile-trigger');
      await contrast('.nav-link');
      await contrast('.profile-trigger');
      await click('.profile-trigger');
      await until("document.querySelector('.profile-dropdown').open");
      await visible('.profile-action');
      await visible('.profile-signout');
      await contrast('.profile-action');
      await contrast('.profile-signout');
      const capture = await send(
        'Page.captureScreenshot',
        { format: 'png' },
        sessionId,
      );
      await writeFile(
        join(artifacts, `${width}-${theme}.png`),
        Buffer.from(capture.data, 'base64'),
      );
      assert.equal(
        await evaluate(
          "!!document.querySelector('.profile-action[aria-current=page]')",
        ),
        true,
      );
      await evaluate("document.querySelector('.profile-action').focus()");
      await send(
        'Input.dispatchKeyEvent',
        { type: 'keyDown', key: 'Escape', code: 'Escape' },
        sessionId,
      );
      await send(
        'Input.dispatchKeyEvent',
        { type: 'keyUp', key: 'Escape', code: 'Escape' },
        sessionId,
      );
      await until(
        "!document.querySelector('.profile-dropdown').open && document.activeElement.matches('.profile-trigger')",
      );
      if (width < 1024) {
        await send(
          'Input.dispatchKeyEvent',
          { type: 'keyDown', key: 'Escape', code: 'Escape' },
          sessionId,
        );
        await send(
          'Input.dispatchKeyEvent',
          { type: 'keyUp', key: 'Escape', code: 'Escape' },
          sessionId,
        );
        await until(
          "document.querySelector('.mobile-nav-toggle').getAttribute('aria-expanded') === 'false' && document.activeElement.matches('.mobile-nav-toggle')",
        );
        await click('.mobile-nav-toggle');
        await until(
          "document.querySelector('.mobile-nav-toggle').getAttribute('aria-expanded') === 'true'",
        );
      }
      await click('.profile-trigger');
      await click('.nav-brand');
      await until("location.pathname === '/'");
      if (width < 1024)
        await until(
          "!document.querySelector('#primary-navigation').checkVisibility()",
        );
      else {
        await until("!!document.querySelector('.nav-link.is-active')");
        await visible('.nav-link.is-active');
        await contrast('.nav-link.is-active');
      }
      assert.equal(
        await evaluate('document.documentElement.scrollWidth <= innerWidth'),
        true,
        'No horizontal overflow',
      );
      await send('Page.reload', {}, sessionId);
      await until(
        `document.documentElement.dataset.theme === ${JSON.stringify(theme)} && !!document.querySelector('.profile-trigger')`,
      );
      await click('.theme-toggle');
      await until(
        `document.documentElement.dataset.theme === ${JSON.stringify(theme === 'dark' ? 'light' : 'dark')}`,
      );
      results.push(
        `${width}px ${theme}: visible navigation/profile, contrast, Escape, route dismissal, no overflow, theme persistence/toggle`,
      );
    }
  }
  // Desktop sign-out failure keeps the authenticated state; success uses CSRF.
  await send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  await send('Page.navigate', { url: `${origin}/account` }, sessionId);
  await until("!!document.querySelector('.profile-trigger')");
  failLogout = true;
  await click('.profile-trigger');
  await click('.profile-signout');
  await until("document.body.innerText.includes('Temporary sign-out failure')");
  await visible('.profile-trigger');
  assert.equal(signedIn, true);
  failLogout = false;
  await click('.profile-signout');
  await until(
    "location.pathname === '/login' && document.querySelector('.nav-auth-button')?.getAttribute('href') === '/login'",
  );
  assert.equal(signedIn, false);
  assert.ok(writes.every((write) => write.csrf === 'isolated-token'));
  assert.equal(
    await evaluate("!!document.querySelector('.profile-dropdown')"),
    false,
  );
  assert.deepEqual(exceptions, []);
  console.log(
    JSON.stringify(
      {
        results,
        signOut:
          'failure preserved session; success retained CSRF and signed-out navigation',
        artifacts,
      },
      null,
      2,
    ),
  );
} finally {
  clearTimeout(deadline);
  await send('Browser.close').catch(() => {});
  chrome.kill('SIGTERM');
  server.close();
}
