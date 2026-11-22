import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import type { MarketAsset, QuoteDto } from '@marketpulse/contracts';
import { HistoryChart } from '../src/features/markets/HistoryChart';
import {
  MarketPolicy,
  QuoteCard,
} from '../src/features/markets/MarketComponents';
import {
  chartPoints,
  change,
  filterAssets,
  money,
  quoteStatus,
} from '../src/features/markets/presentation';
import {
  historyInterval,
  loadHistory,
  loadOverview,
  MarketRequestError,
  retryDelay,
  type History,
} from '../src/features/markets/api';

const id = '00000000-0000-4000-8000-000000000001';
const stock: MarketAsset = {
  id,
  key: 'stock:aapl',
  symbol: 'AAPL',
  name: 'Apple',
  type: 'STOCK',
  exchange: 'NASDAQ',
  quoteCurrency: 'USD',
  isDemoOnly: true,
};
const crypto: MarketAsset = {
  ...stock,
  id: '00000000-0000-4000-8000-000000000002',
  key: 'crypto:bitcoin',
  symbol: 'BTC',
  name: 'Bitcoin',
  type: 'CRYPTO',
  exchange: null,
  isDemoOnly: false,
};
const timestamp = '2026-11-22T12:00:00.000Z';
const quote: QuoteDto = {
  assetId: id,
  provider: 'DEMO',
  mode: 'DEMO',
  currency: 'USD',
  simulated: true,
  status: 'fresh',
  price: '100.125',
  changePercent: null,
  sourceAt: timestamp,
  fetchedAt: timestamp,
  reason: null,
};
const history: History = {
  assetId: id,
  range: '1D',
  provider: 'DEMO',
  mode: 'DEMO',
  currency: 'USD',
  simulated: true,
  status: 'fresh',
  refresh: 'idle',
  granularity: '5m',
  fetchedAt: timestamp,
  reason: null,
  points: [
    { timestamp, price: '100.125' },
    { timestamp: '2026-11-22T12:05:00.000Z', price: '100.125' },
  ],
};
const status = {
  cryptoMode: 'demo',
  stockMode: 'demo',
  refreshSeconds: { crypto: 60, stocks: 60 },
  workerEnabled: true,
  attribution: 'Synthetic',
};

test('catalog search combines type and case-insensitive name/symbol without mutating the catalog', () => {
  const assets = [crypto, stock];
  assert.deepEqual(filterAssets(assets, ' APP ', 'STOCK', 'name'), [stock]);
  assert.deepEqual(filterAssets(assets, 'btc', 'CRYPTO', 'symbol'), [crypto]);
  assert.deepEqual(filterAssets(assets, 'Bitcoin', 'STOCK', 'name'), []);
  assert.deepEqual(filterAssets(assets, '', 'ALL', 'name'), [stock, crypto]);
  assert.deepEqual(assets, [crypto, stock]);
});

test('missing prices and changes are never presented as zero; source time determines staleness', () => {
  assert.equal(money(null), 'Unavailable');
  assert.equal(money('0.000000001'), '< $0.00000001');
  assert.equal(change(null), 'Change unavailable');
  assert.equal(change('-1.5'), '-1.50%');
  const now = Date.parse(timestamp);
  assert.equal(quoteStatus(quote, now + 121_000), 'stale');
  assert.equal(
    quoteStatus(
      { ...quote, provider: 'COINGECKO', mode: 'REAL', simulated: false },
      now + 121_000,
    ),
    'fresh',
  );
  assert.equal(quoteStatus({ ...quote, sourceAt: null }, now), 'unavailable');
  assert.equal(
    quoteStatus(
      { ...quote, sourceAt: new Date(now + 61_000).toISOString() },
      now,
    ),
    'stale',
  );
});

test('price cards and policy persistently identify synthetic stocks and actual provenance', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <QuoteCard asset={stock} quote={quote} />
    </MemoryRouter>,
  );
  assert.match(html, /Simulated data/);
  assert.match(html, /DEMO/);
  assert.match(html, /Observed/);
  assert.match(html, /Change unavailable/);
  assert.match(html, new RegExp(`/assets/${id}`));
  const policy = renderToStaticMarkup(
    <MarketPolicy
      cryptoMode="coingecko"
      cryptoSeconds={600}
      workerEnabled={false}
    />,
  );
  assert.match(policy, /simulated stock data/);
  assert.match(policy, /coingecko.com/);
  assert.match(policy, /worker is disabled/);
  assert.match(policy, /10 min/);
});

test('flat historical series renders finite geometry, keyboard exploration and exact table values', () => {
  const html = renderToStaticMarkup(
    <HistoryChart history={history} name="Apple" />,
  );
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.match(html, /type="range"/);
  assert.match(html, /100.125/);
  assert.match(html, /Simulated data/);
  assert.match(html, /DEMO/);
  assert.match(html, /View 2 observations/);
  const pending = renderToStaticMarkup(
    <HistoryChart
      history={{
        ...history,
        points: [],
        refresh: 'pending',
        status: 'unavailable',
      }}
      name="Apple"
    />,
  );
  assert.match(pending, /Preparing price history/);
  assert.doesNotMatch(pending, /<svg/);
});

test('chart input rejects unusable observations and orders by real timestamps', () => {
  const points = chartPoints({
    points: [...history.points].reverse().concat([
      { timestamp: 'invalid', price: '100' },
      { timestamp, price: '-1' },
    ]),
  });
  assert.equal(points.length, 2);
  assert.ok(points[0]!.time < points[1]!.time);
});

test('overview makes one catalog read and one quote batch, validates responses and uses same-origin credentials', async () => {
  const original = globalThis.fetch;
  const paths: string[] = [];
  try {
    globalThis.fetch = async (input, options) => {
      paths.push(String(input));
      assert.equal(options?.credentials, 'same-origin');
      assert.equal(options?.cache, 'no-store');
      const body = String(input).includes('/assets')
        ? { assets: [stock, crypto], total: 2 }
        : String(input).includes('/quotes')
          ? { quotes: [quote] }
          : status;
      return new Response(JSON.stringify(body));
    };
    const result = await loadOverview(new AbortController().signal);
    assert.equal(result.assets.length, 2);
    assert.deepEqual(paths.sort(), [
      '/api/v1/assets?limit=15',
      '/api/v1/market-status',
      '/api/v1/quotes',
    ]);
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          assets: [{ symbol: 'invalid' }],
          quotes: [],
          total: 1,
        }),
      );
    await assert.rejects(() => loadOverview(new AbortController().signal));
  } finally {
    globalThis.fetch = original;
  }
});

test('pending 202 history is accepted, cancelled range changes do not send requests', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return new Response(
        JSON.stringify({
          ...history,
          points: [],
          refresh: 'pending',
          status: 'unavailable',
        }),
        { status: 202 },
      );
    };
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => loadHistory(id, '7D', controller.signal), {
      name: 'AbortError',
    });
    assert.equal(calls, 0);
    const result = await loadHistory(id, '1D', new AbortController().signal);
    assert.equal(result.refresh, 'pending');
    assert.equal(calls, 1);
    assert.equal(historyInterval(result), 20_000);
    assert.equal(historyInterval(history), 60_000);
  } finally {
    globalThis.fetch = original;
  }
});

test('range changes are serialized and spaced without charging cancelled requests', async (context) => {
  const original = globalThis.fetch;
  let calls = 0;
  context.mock.timers.enable({
    apis: ['Date', 'setTimeout'],
    now: Date.now() + 20_000,
  });
  try {
    globalThis.fetch = async () => {
      calls++;
      return new Response(JSON.stringify(history));
    };
    const first = loadHistory(id, '1D', new AbortController().signal);
    await nextTurn();
    context.mock.timers.tick(0);
    await first;
    assert.equal(calls, 1);
    const cancelled = new AbortController();
    const waiting = loadHistory(id, '7D', cancelled.signal);
    await nextTurn();
    cancelled.abort();
    await assert.rejects(() => waiting, { name: 'AbortError' });
    const last = loadHistory(id, '1Y', new AbortController().signal);
    await nextTurn();
    context.mock.timers.tick(10_000);
    await nextTurn();
    assert.equal(calls, 1);
    context.mock.timers.tick(100);
    await last;
    assert.equal(calls, 2);
  } finally {
    context.mock.timers.reset();
    globalThis.fetch = original;
  }
});

test('429 honors numeric/date Retry-After and blocks manual retries during cooldown', async () => {
  assert.equal(retryDelay('120'), 120_000);
  assert.equal(retryDelay('invalid'), 60_000);
  const now = Date.parse(timestamp);
  assert.equal(retryDelay('Sun, 22 Nov 2026 12:02:00 GMT', now), 120_000);
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return new Response('{}', {
        status: 429,
        headers: { 'Retry-After': '120' },
      });
    };
    await assert.rejects(
      () => loadOverview(new AbortController().signal),
      (error: unknown) =>
        error instanceof MarketRequestError && error.retryMs >= 119_000,
    );
    const before = calls;
    await assert.rejects(
      () => loadOverview(new AbortController().signal),
      MarketRequestError,
    );
    assert.equal(calls, before);
  } finally {
    globalThis.fetch = original;
  }
});
