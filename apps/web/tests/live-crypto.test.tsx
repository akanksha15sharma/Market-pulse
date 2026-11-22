import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import {
  quoteSchema,
  historyResponseSchema,
  type MarketAsset,
  type QuoteDto,
  type MarketStatus,
} from '@marketpulse/contracts';
import {
  QuoteCard,
  MarketPolicy,
} from '../src/features/markets/MarketComponents';
import { HistoryChart } from '../src/features/markets/HistoryChart';
import { WatchlistAssets } from '../src/features/watchlists/WatchlistAssets';
import { historyStatus } from '../src/features/markets/presentation';
import {
  loadAsset,
  loadOverview,
  loadHistory,
  type History,
} from '../src/features/markets/api';

const NOW = Date.now();
const date = new Date(NOW).toISOString();
const crypto: MarketAsset = {
  id: '00000000-0000-4000-8000-000000000001',
  key: 'crypto:bitcoin',
  name: 'Bitcoin',
  symbol: 'BTC',
  type: 'CRYPTO',
  exchange: null,
  quoteCurrency: 'USD',
  isDemoOnly: false,
};
const stock: MarketAsset = {
  ...crypto,
  id: '00000000-0000-4000-8000-000000000002',
  key: 'stock:aapl',
  name: 'Apple',
  symbol: 'AAPL',
  type: 'STOCK',
  exchange: 'NASDAQ',
  isDemoOnly: true,
};
const quote: QuoteDto = {
  assetId: crypto.id,
  provider: 'COINGECKO',
  mode: 'REAL',
  simulated: false,
  status: 'fresh',
  currency: 'USD',
  price: '123.45',
  changePercent: '1.5',
  sourceAt: date,
  fetchedAt: date,
  reason: null,
};
const history: History = {
  assetId: crypto.id,
  provider: 'COINGECKO',
  mode: 'REAL',
  simulated: false,
  status: 'fresh',
  currency: 'USD',
  range: '1D',
  granularity: '5m',
  refresh: 'idle',
  fetchedAt: date,
  reason: null,
  sourceAt: date,
  freshUntil: new Date(NOW + 1800_000).toISOString(),
  expiresAt: new Date(NOW + 48 * 3600_000).toISOString(),
  points: [
    { timestamp: new Date(NOW - 300_000).toISOString(), price: '122' },
    { timestamp: date, price: '123.45' },
  ],
};
const status: MarketStatus = {
  cryptoMode: 'coingecko',
  stockMode: 'demo',
  refreshSeconds: { crypto: 600, stocks: 60 },
  workerEnabled: true,
  alwaysOn: false,
  attribution: 'Data provided by CoinGecko',
  providers: [
    {
      provider: 'COINGECKO',
      enabled: true,
      disabled: false,
      lastError: null,
      blockedUntil: null,
      lastSuccessAt: date,
      quoteReason: null,
      historyReason: 'quota_exhausted',
      budgets: [
        { category: 'all:month', remaining: 7999, resetsAt: date },
        { category: 'charts:day', remaining: 0, resetsAt: date },
      ],
    },
  ],
};
const renderCard = (value: QuoteDto) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <QuoteCard asset={crypto} quote={value} />
    </MemoryRouter>,
  );

test('real, stale and unavailable price cards keep provenance and never display substitute prices', () => {
  const fresh = renderCard(quote);
  assert.match(fresh, /Real market data/);
  assert.match(fresh, /COINGECKO/);
  assert.match(fresh, /\$123\.45/);
  assert.doesNotMatch(fresh, /Simulated data/);
  const stale = renderCard({
    ...quote,
    sourceAt: new Date(NOW - 21 * 60_000).toISOString(),
    status: 'stale',
  });
  assert.match(stale, /stale/);
  assert.match(stale, /out of date/);
  assert.match(stale, /\$123\.45/);
  const missing = renderCard({
    ...quote,
    status: 'unavailable',
    price: null,
    changePercent: null,
    sourceAt: null,
    reason: 'unauthorized',
  });
  assert.match(missing, /Unavailable/);
  assert.match(missing, /authentication failed/);
  assert.match(missing, /No simulated replacement/);
  assert.doesNotMatch(missing, /\$123\.45/);
});

test('real charts distinguish source staleness from fetch time and hide expired cached data', () => {
  const stale = {
    ...history,
    sourceAt: new Date(NOW - 3600_000).toISOString(),
    points: [
      { timestamp: new Date(NOW - 3600_000).toISOString(), price: '123' },
    ],
  };
  assert.equal(historyStatus(stale, NOW), 'stale');
  const html = renderToStaticMarkup(
    <HistoryChart history={stale} name="Bitcoin" />,
  );
  assert.match(html, /Real market data/);
  assert.match(html, /stale/);
  assert.match(html, /Data provided by/);
  assert.match(html, /coingecko.com\/en\/api/);
  const expired = { ...history, expiresAt: new Date(NOW - 1).toISOString() };
  assert.equal(historyStatus(expired, NOW), 'unavailable');
  const empty = renderToStaticMarkup(
    <HistoryChart history={expired} name="Bitcoin" />,
  );
  assert.match(empty, /COINGECKO/);
  assert.match(empty, /History unavailable/);
  assert.doesNotMatch(empty, /<svg|123.45/);
  assert.match(empty, /No simulated history/);
});

test('watchlists combine real crypto and explicitly simulated stocks without combining their provenance', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <WatchlistAssets
        items={[crypto, stock].map((asset) => ({
          asset,
          available: true,
          addedAt: date,
        }))}
        quotes={[
          quote,
          {
            ...quote,
            assetId: stock.id,
            provider: 'DEMO',
            mode: 'DEMO',
            simulated: true,
          },
        ]}
        disabled={false}
        remove={(asset) => <button>Remove {asset.name}</button>}
      />
    </MemoryRouter>,
  );
  assert.match(html, /Real market data/);
  assert.match(html, /Simulated data/);
  assert.match(html, /COINGECKO/);
  assert.match(html, /DEMO/);
});

test('live policy exposes chart-only quota exhaustion, source attribution and application budgets', () => {
  const html = renderToStaticMarkup(
    <MarketPolicy
      cryptoMode="coingecko"
      cryptoSeconds={600}
      workerEnabled
      providers={status.providers}
    />,
  );
  assert.match(html, /Data provided by/);
  assert.match(html, /Historical charts/);
  assert.match(html, /budget is exhausted/);
  assert.match(html, /7999/);
  assert.match(html, /Stocks remain simulated/);
  assert.doesNotMatch(html, /Live crypto updates unavailable/);
  const unavailable = renderToStaticMarkup(
    <MarketPolicy
      cryptoMode="coingecko"
      cryptoSeconds={600}
      workerEnabled
      providers={[{ ...status.providers[0]!, quoteReason: 'not_configured' }]}
    />,
  );
  assert.match(unavailable, /Live crypto updates unavailable/);
  assert.match(unavailable, /not configured on the server/);
});

test('public schemas reject real/demo provenance mismatches', () => {
  assert.equal(
    quoteSchema.safeParse({ ...quote, simulated: true }).success,
    false,
  );
  assert.equal(
    quoteSchema.safeParse({ ...quote, provider: 'DEMO' }).success,
    false,
  );
  assert.equal(
    historyResponseSchema.safeParse({ ...history, mode: 'DEMO' }).success,
    false,
  );
  assert.equal(
    historyResponseSchema.safeParse({ ...history, simulated: true }).success,
    false,
  );
});

test('dashboard and detail clients use only the backend and reject a demo quote in live crypto mode', async () => {
  const original = globalThis.fetch;
  const paths: string[] = [];
  try {
    globalThis.fetch = async (input) => {
      const path = String(input);
      paths.push(path);
      assert.ok(path.startsWith('/api/v1/'));
      return Response.json(
        path.includes('/market-status')
          ? status
          : path.includes('/quotes')
            ? { quotes: [quote] }
            : path.includes('/assets?')
              ? { assets: [crypto], total: 1 }
              : { asset: crypto },
      );
    };
    assert.equal(
      (await loadOverview(new AbortController().signal)).quotes[0]?.provider,
      'COINGECKO',
    );
    assert.equal(
      (await loadAsset(crypto.id, new AbortController().signal)).quote
        ?.simulated,
      false,
    );
    assert.equal(paths.length, 6);
    globalThis.fetch = async (input) =>
      Response.json(
        String(input).includes('/market-status')
          ? status
          : String(input).includes('/quotes')
            ? {
                quotes: [
                  { ...quote, provider: 'DEMO', mode: 'DEMO', simulated: true },
                ],
              }
            : { assets: [crypto], total: 1 },
      );
    await assert.rejects(
      () => loadOverview(new AbortController().signal),
      /mode changed/,
    );
    globalThis.fetch = async (input) =>
      Response.json(
        String(input).includes('/market-status')
          ? status
          : String(input).includes('/quotes')
            ? { quotes: [{ ...quote, assetId: stock.id }] }
            : { assets: [stock], total: 1 },
      );
    await assert.rejects(
      () => loadOverview(new AbortController().signal),
      /mode changed/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('detail history rejects a simulated series if the asset view selected real crypto', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      assert.ok(String(input).startsWith('/api/v1/assets/'));
      return Response.json({
        ...history,
        provider: 'DEMO',
        mode: 'DEMO',
        simulated: true,
      });
    };
    await assert.rejects(
      () =>
        loadHistory(crypto.id, '1D', new AbortController().signal, 'COINGECKO'),
      /mode changed/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
