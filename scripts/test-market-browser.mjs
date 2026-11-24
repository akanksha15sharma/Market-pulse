// Isolated tests of the PRODUCTION frontend. No database, real quotes or account writes.
// Run npm run build first with NODE_ENV=production, then node scripts/test-market-browser.mjs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
const root = resolve('apps/web/dist');
const artifacts = await mkdtemp(join(tmpdir(), 'marketpulse-browser-'));
const id = '00000000-0000-4000-8000-000000000001';
const asset = {
  id,
  key: 'stock:NASDAQ:AAPL',
  symbol: 'AAPL',
  name: 'Apple',
  type: 'STOCK',
  exchange: 'NASDAQ',
  quoteCurrency: 'USD',
  isDemoOnly: true,
};
const requests = [];
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.startsWith('/api/')) {
    requests.push(path);
    const body =
      path === '/api/v1/assets'
        ? { assets: [asset], total: 1 }
        : path === `/api/v1/assets/${id}`
          ? { asset }
          : { error: 'Unexpected native request' };
    res.writeHead('error' in body ? 500 : 200, {
      'Content-Type': 'application/json',
    });
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
  res.writeHead(200, {
    'Content-Type':
      {
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.svg': 'image/svg+xml',
      }[extname(file)] ?? 'application/octet-stream',
  });
  res.end(data);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
const chrome = spawn(
  process.env.CHROME_BIN ?? '/usr/bin/google-chrome',
  [
    '--headless',
    '--no-sandbox',
    '--remote-debugging-pipe',
    `--user-data-dir=${artifacts}/profile`,
    '--no-first-run',
    '--disable-background-networking',
    '--disable-sync',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
);
let sequence = 0,
  buffer = '',
  blocked = true;
const pending = new Map(),
  exceptions = [],
  results = [];
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
    if (message.method === 'Fetch.requestPaused') {
      // Fake only the embedding shell, never market prices. Provider contents stay opaque.
      const fixture =
        "(()=>{const f=document.createElement('iframe');f.srcdoc='<p>Isolated display fixture; no market prices</p>';document.currentScript.parentElement.querySelector('.tradingview-widget-container__widget').appendChild(f);})();";
      const action = blocked
        ? send(
            'Fetch.failRequest',
            {
              requestId: message.params.requestId,
              errorReason: 'BlockedByClient',
            },
            message.sessionId,
          )
        : send(
            'Fetch.fulfillRequest',
            {
              requestId: message.params.requestId,
              responseCode: 200,
              responseHeaders: [
                { name: 'Content-Type', value: 'text/javascript' },
              ],
              body: Buffer.from(fixture).toString('base64'),
            },
            message.sessionId,
          );
      action.catch(() => {});
    }
  }
});
const deadline = setTimeout(() => {
  chrome.kill('SIGKILL');
  server.close();
  process.exitCode = 1;
}, 55000);
try {
  const target = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send(
    'Fetch.enable',
    {
      patterns: [
        { urlPattern: 'https://s3.tradingview.com/*', requestStage: 'Request' },
      ],
    },
    sessionId,
  );
  const evaluate = async (expression) =>
    (
      await send(
        'Runtime.evaluate',
        { expression, returnByValue: true },
        sessionId,
      )
    ).result.value;
  async function until(expression) {
    for (let i = 0; i < 80; i++) {
      if (await evaluate(expression)) return;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(
      `Expected browser state: ${expression}; diagnostics=${await evaluate('JSON.stringify({theme:document.documentElement.dataset.theme,button:document.querySelector(".theme-toggle")?.textContent,frames:document.querySelectorAll("iframe").length,text:document.body.innerText.slice(-1200)})')}; exceptions=${JSON.stringify(exceptions)}`,
    );
  }
  for (const mobile of [false, true]) {
    await send(
      'Emulation.setDeviceMetricsOverride',
      {
        width: mobile ? 390 : 1280,
        height: mobile ? 844 : 900,
        deviceScaleFactor: 1,
        mobile,
      },
      sessionId,
    );
    blocked = true;
    await send(
      'Page.navigate',
      { url: `http://127.0.0.1:${port}/markets` },
      sessionId,
    );
    await until(
      "document.body.innerText.includes('could not be loaded') && document.body.innerText.includes('Apple')",
    );
    assert.equal(
      await evaluate('document.documentElement.scrollWidth > innerWidth'),
      false,
    );
    assert.equal(
      await evaluate(
        '/Simulated data|simulated stocks|105\\.00|request budget|worker is/.test(document.body.innerText)',
      ),
      false,
    );
    blocked = false;
    await evaluate(
      "[...document.querySelectorAll('button')].find(x=>x.textContent==='Retry display').click()",
    );
    await until(
      "document.querySelector('iframe[title*=" +
        JSON.stringify('TradingView') +
        "]') && !document.querySelector('.tradingview-widget-container').getAttribute('aria-busy').includes('true')",
    );
    const before = await evaluate('document.documentElement.dataset.theme');
    await evaluate("document.querySelector('.theme-toggle').click()");
    await until(
      `document.documentElement.dataset.theme !== ${JSON.stringify(before)} && !!document.querySelector('iframe')`,
    );
    await evaluate(`document.querySelector('a[href="/assets/${id}"]').click()`);
    await until(
      "document.querySelector('h1')?.textContent.includes('Apple') && !!document.querySelector('iframe[title=" +
        JSON.stringify('Apple — TradingView') +
        "]')",
    );
    assert.equal(
      await evaluate('document.documentElement.scrollWidth > innerWidth'),
      false,
    );
    const screenshot = await send(
      'Page.captureScreenshot',
      { format: 'png' },
      sessionId,
    );
    await writeFile(
      join(artifacts, `${mobile ? 'mobile' : 'desktop'}.png`),
      Buffer.from(screenshot.data, 'base64'),
    );
    results.push({
      viewport: mobile ? '390x844' : '1280x900',
      failureRetry: 'pass',
      chartNavigation: 'pass',
      themeSwitch: 'pass',
      horizontalOverflow: false,
    });
  }
  assert.deepEqual(exceptions, []);
  assert.ok(
    requests.every(
      (path) => path === '/api/v1/assets' || path === `/api/v1/assets/${id}`,
    ),
    'Production UI requested native data',
  );
  console.log(
    JSON.stringify(
      {
        results,
        requests,
        exceptions,
        artifacts,
        limitation:
          'Embedded shells are mocked. Real third-party data delivery and chart controls require separate browser verification.',
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
