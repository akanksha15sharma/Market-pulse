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
const cryptoId = '00000000-0000-4000-8000-000000000002';
const cryptoAsset = {
  ...asset,
  id: cryptoId,
  key: 'crypto:bitcoin',
  symbol: 'BTC',
  name: 'Bitcoin',
  type: 'CRYPTO',
  exchange: null,
  isDemoOnly: false,
};
const requests = [];
let catalogScenario = 'normal';
let scenarioRequests = 0;
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.startsWith('/api/')) {
    requests.push(path);
    if (path === '/api/v1/assets') {
      scenarioRequests++;
      if (catalogScenario === 'slow')
        await new Promise((resolve) => setTimeout(resolve, 12_000));
      if (
        (catalogScenario === 'transient' || catalogScenario === 'quota') &&
        scenarioRequests === 1
      ) {
        res.writeHead(catalogScenario === 'quota' ? 429 : 503, {
          'Content-Type': 'application/json',
          ...(catalogScenario === 'quota' ? { 'Retry-After': '120' } : {}),
        });
        res.end(JSON.stringify({ error: 'Isolated unavailable-service test' }));
        return;
      }
    }
    const body =
      path === '/api/v1/assets'
        ? { assets: [asset, cryptoAsset], total: 2 }
        : path === `/api/v1/assets/${id}`
          ? { asset }
          : path === `/api/v1/assets/${cryptoId}`
            ? { asset: cryptoAsset }
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
  blocked = true,
  silent = false;
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
        "(()=>{const host=document.currentScript.parentElement;host.style.width='100%';host.style.height='100%';const style=document.createElement('style');style.textContent='.tradingview-widget-copyright .blue-text{color:#2962ff!important}.tradingview-widget-copyright .trademark{color:#b2b5be!important}';document.head.appendChild(style);const f=document.createElement('iframe');f.style.cssText='display:block;border:0;width:100%;height:100%';f.srcdoc='<p>Isolated display fixture; no market prices</p>';document.currentScript.parentElement.querySelector('.tradingview-widget-container__widget').appendChild(f);})();";
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
              body: Buffer.from(
                silent
                  ? '/* Loaded script without a frame: timeout fixture. */'
                  : fixture,
              ).toString('base64'),
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
}, 240000);
try {
  const target = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', {
    targetId: target.targetId,
    flatten: true,
  });
  await send('Page.enable', {}, sessionId);
  await send('Network.enable', {}, sessionId);
  await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
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
        { expression, returnByValue: true, awaitPromise: true },
        sessionId,
      )
    ).result.value;
  async function until(expression) {
    for (let i = 0; i < 260; i++) {
      if (await evaluate(expression)) return;
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error(
      `Expected browser state: ${expression}; diagnostics=${await evaluate('JSON.stringify({theme:document.documentElement.dataset.theme,button:document.querySelector(".theme-toggle")?.textContent,frames:document.querySelectorAll("iframe").length,text:document.body.innerText.slice(-1200)})')}; exceptions=${JSON.stringify(exceptions)}`,
    );
  }
  async function assertVisible(selector) {
    const measurement = JSON.parse(
      await evaluate(`(async () => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return JSON.stringify({ ok: false, reason: 'missing element' });
      // Scroll the page only: scrollIntoView can secretly scroll overflow:hidden ancestors.
      const initial = el.getBoundingClientRect();
      window.scrollTo({ top: Math.max(0, scrollY + initial.top - (innerHeight - initial.height) / 2), left: 0 });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const reasons = [];
      if (!el.getClientRects().length) reasons.push('no rendered boxes');
      for (const box of el.getClientRects()) {
        if (box.width < 1 || box.height < 1) reasons.push('zero size');
        if (box.left < -1 || box.right > innerWidth + 1 || box.top < -1 || box.bottom > innerHeight + 1) reasons.push('outside viewport');
        for (let node = el; node; node = node.parentElement) {
          const style = getComputedStyle(node), clip = node.getBoundingClientRect();
          if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) reasons.push('hidden style');
          if (node !== el) {
            if (['hidden','clip','auto','scroll'].includes(style.overflowX) && (box.left < clip.left - 1 || box.right > clip.right + 1)) reasons.push('horizontal clipping');
            if (['hidden','clip','auto','scroll'].includes(style.overflowY) && (box.top < clip.top - 1 || box.bottom > clip.bottom + 1)) reasons.push('vertical clipping');
          }
        }
        for (const [x,y] of [[box.left+2,box.top+2],[box.right-2,box.bottom-2],[(box.left+box.right)/2,(box.top+box.bottom)/2]]) {
          const hit = document.elementFromPoint(x,y);
          if (hit !== el && !el.contains(hit)) reasons.push('covered or clipped');
        }
      }
      const box = el.getBoundingClientRect(), panel = el.closest('.widget-panel')?.getBoundingClientRect();
      if (panel && (box.top < panel.top - 1 || box.bottom > panel.bottom + 1)) reasons.push('outside panel bounds');
      return JSON.stringify({ ok: reasons.length === 0, reasons, height: box.height });
    })()`),
    );
    assert.equal(
      measurement.ok,
      true,
      `${selector}: ${JSON.stringify(measurement)}`,
    );
  }
  async function assertWidgetVisible() {
    for (const selector of [
      '.widget-panel h2',
      '.market-widget-viewport',
      '.tradingview-widget-container iframe',
      '.tradingview-widget-copyright',
      '.tradingview-widget-copyright a',
      '.widget-panel .price-meta:first-of-type',
      '.widget-panel .price-meta:last-of-type',
    ])
      await assertVisible(selector);
    const geometry = JSON.parse(
      await evaluate(`JSON.stringify((() => {
      const wrapper = document.querySelector('.market-widget-viewport').getBoundingClientRect();
      const frame = document.querySelector('.tradingview-widget-container iframe').getBoundingClientRect();
      return { wrapper: wrapper.height, frame: frame.height, expected: innerWidth <= 640 ? 500 : 560 };
    })())`),
    );
    const contrast = JSON.parse(
      await evaluate(`JSON.stringify([...document.querySelectorAll('.tradingview-widget-copyright .blue-text, .tradingview-widget-copyright .trademark')].map(el => {
      function rgb(color) { return color.slice(color.indexOf('(')+1,-1).split(',').slice(0,3).map(Number); }
      function luminance(color) { const c = rgb(color).map(x => { x /= 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return c[0]*0.2126+c[1]*0.7152+c[2]*0.0722; }
      let parent = el;
      while (parent && ['transparent','rgba(0, 0, 0, 0)'].includes(getComputedStyle(parent).backgroundColor)) parent = parent.parentElement;
      const foreground = luminance(getComputedStyle(el).color), background = luminance(getComputedStyle(parent).backgroundColor);
      return { text: el.textContent, ratio: (Math.max(foreground,background)+0.05)/(Math.min(foreground,background)+0.05) };
    }))`),
    );
    assert.equal(contrast.length, 2);
    for (const value of contrast)
      assert.ok(
        value.ratio >= 4.5,
        `Attribution contrast: ${JSON.stringify(value)}`,
      );
    assert.equal(geometry.wrapper, geometry.expected);
    assert.ok(
      geometry.frame >= geometry.wrapper - 2 &&
        geometry.frame <= geometry.wrapper + 2,
      JSON.stringify(geometry),
    );
  }
  for (const [width, height] of [
    [1280, 900],
    [768, 1024],
    [390, 844],
  ]) {
    const mobile = width < 640;

    await send(
      'Emulation.setDeviceMetricsOverride',
      {
        width,
        height,
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
    await assertWidgetVisible();
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
    await assertWidgetVisible();
    for (const theme of ['dark', 'light']) {
      await evaluate(
        `localStorage.setItem('marketpulse-theme', ${JSON.stringify(theme)}); window.dispatchEvent(new Event('marketpulse-theme'));`,
      );
      await until(
        `document.documentElement.dataset.theme === ${JSON.stringify(theme)}`,
      );
      for (const path of ['/markets', `/assets/${id}`, `/assets/${cryptoId}`]) {
        await send(
          'Page.navigate',
          { url: `http://127.0.0.1:${port}${path}` },
          sessionId,
        );
        await until(
          "!!document.querySelector('iframe') && document.querySelector('.tradingview-widget-container').getAttribute('aria-busy') === 'false'",
        );
        await assertWidgetVisible();
      }
    }
    // Negative control: DOM presence must not pass when a parent clips the footer.
    await evaluate(
      "document.querySelector('.widget-panel').style.cssText='height:80px;overflow:hidden'",
    );
    await assert.rejects(assertVisible('.tradingview-widget-copyright'));
    await evaluate(
      "document.querySelector('.widget-panel').removeAttribute('style')",
    );
    await assertWidgetVisible();
    await evaluate(
      "(()=>{const overlay=document.createElement('div');overlay.id='visibility-negative-control';overlay.style.cssText='position:fixed;inset:0;z-index:2147483647;background:white';document.body.appendChild(overlay)})()",
    );
    await assert.rejects(assertVisible('.tradingview-widget-copyright'));
    await evaluate(
      "document.getElementById('visibility-negative-control').remove()",
    );
    await assertWidgetVisible();
    const screenshot = await send(
      'Page.captureScreenshot',
      { format: 'png' },
      sessionId,
    );
    await writeFile(
      join(artifacts, `viewport-${width}.png`),
      Buffer.from(screenshot.data, 'base64'),
    );
    results.push({
      viewport: `${width}x${height}`,
      visualVisibility:
        'overview/stock/crypto, dark/light, clipping negative control passed',
      failureRetry: 'pass',
      chartNavigation: 'pass',
      themeSwitch: 'pass',
      horizontalOverflow: false,
    });
  }
  catalogScenario = 'slow';
  scenarioRequests = 0;
  await send(
    'Page.navigate',
    { url: `http://127.0.0.1:${port}/markets` },
    sessionId,
  );
  await until(
    "document.body.innerText.includes('Loading market information') && !!document.querySelector('iframe')",
  );
  await until(
    "document.querySelectorAll('.market-table tbody tr').length === 2",
  );
  assert.equal(
    scenarioRequests,
    1,
    'A slow successful catalog must not be duplicated',
  );
  assert.equal(
    await evaluate("!!document.querySelector('[role=alert]')"),
    false,
  );
  results.push({
    catalogDelay12Seconds:
      'single request recovered beyond previous 10-second timeout',
  });
  catalogScenario = 'transient';
  scenarioRequests = 0;
  await send(
    'Page.navigate',
    { url: `http://127.0.0.1:${port}/markets` },
    sessionId,
  );
  await until("document.body.innerText.includes('Retrying automatically')");
  await until(
    "document.querySelectorAll('.market-table tbody tr').length === 2",
  );
  assert.equal(
    scenarioRequests,
    2,
    'One automatic retry should recover the catalog',
  );
  catalogScenario = 'transient';
  scenarioRequests = 0;
  await send(
    'Page.navigate',
    { url: `http://127.0.0.1:${port}/markets` },
    sessionId,
  );
  await until("document.body.innerText.includes('Retrying automatically')");
  await evaluate(
    "[...document.querySelectorAll('button')].find(e=>e.textContent === 'Try again').click()",
  );
  await until(
    "document.querySelectorAll('.market-table tbody tr').length === 2",
  );
  assert.equal(scenarioRequests, 2);
  results.push({
    transientCatalogFailure:
      'automatic and manual retry recover without native data',
  });
  catalogScenario = 'quota';
  scenarioRequests = 0;
  await send(
    'Page.navigate',
    { url: `http://127.0.0.1:${port}/markets` },
    sessionId,
  );
  await until("document.body.innerText.includes('Request limit reached')");
  await evaluate(
    "[...document.querySelectorAll('button')].find(e=>e.textContent === 'Try again').click()",
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(
    scenarioRequests,
    1,
    'Manual retry must honor the rate-limit cooldown',
  );
  results.push({ rateLimit: 'manual retry does not bypass Retry-After' });
  catalogScenario = 'normal';
  scenarioRequests = 0;
  silent = true;
  await send(
    'Page.navigate',
    { url: `http://127.0.0.1:${port}/markets` },
    sessionId,
  );
  await until("document.body.innerText.includes('could not be loaded')");
  results.push({ loadedScriptWithoutFrame: 'timeout fallback passed' });
  if (process.env.MARKET_BROWSER_LIVE_WIDGETS === '1') {
    await send('Fetch.disable', {}, sessionId);
    for (const [width, height] of [
      [1280, 900],
      [768, 1024],
      [390, 844],
    ]) {
      await send(
        'Emulation.setDeviceMetricsOverride',
        { width, height, deviceScaleFactor: 1, mobile: width < 640 },
        sessionId,
      );
      for (const theme of ['dark', 'light']) {
        await evaluate(
          `localStorage.setItem('marketpulse-theme', ${JSON.stringify(theme)}); window.dispatchEvent(new Event('marketpulse-theme'));`,
        );
        for (const [label, path] of [
          ['overview', '/markets'],
          ['stock', `/assets/${id}`],
          ['crypto', `/assets/${cryptoId}`],
        ]) {
          await send(
            'Page.navigate',
            { url: `http://127.0.0.1:${port}${path}` },
            sessionId,
          );
          await until(
            "!!document.querySelector('iframe') && document.querySelector('.tradingview-widget-container').getAttribute('aria-busy') === 'false'",
          );
          await new Promise((resolve) => setTimeout(resolve, 4000));
          await assertWidgetVisible();
          const shot = await send(
            'Page.captureScreenshot',
            { format: 'png' },
            sessionId,
          );
          await writeFile(
            join(artifacts, `live-${width}-${theme}-${label}.png`),
            Buffer.from(shot.data, 'base64'),
          );
          results.push({
            actualProvider: label,
            viewport: `${width}x${height}`,
            theme,
            geometryAndAttributionVisible: true,
            note: 'Official frame, full container bounds and hit-tested disclosures verified. No financial values extracted.',
          });
        }
      }
    }
  }

  assert.deepEqual(exceptions, []);
  assert.ok(
    requests.every(
      (path) =>
        path === '/api/v1/assets' ||
        path === `/api/v1/assets/${id}` ||
        path === `/api/v1/assets/${cryptoId}`,
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
          process.env.MARKET_BROWSER_LIVE_WIDGETS === '1'
            ? 'Failure tests use mocked shells; optional real official frames are captured separately. Iframe presence does not verify feed accuracy or every symbol entitlement.'
            : 'Embedded shells are mocked. Real third-party data delivery and chart controls require separate browser verification.',
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
