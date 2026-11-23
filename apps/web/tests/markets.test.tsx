import {
  initialResourceState,
  resourceReducer,
} from '../src/features/markets/resource-state';
import {
  AssetInformation,
  HistoryRangeFilters,
} from '../src/features/markets/AssetInformation';
import {
  historyRanges,
  historySummary,
  nearestObservation,
} from '../src/features/markets/presentation';
import { FavoriteButton } from '../src/features/markets/FavoriteButton';
import {
  favoritesStorageKey,
  readFavorites,
  writeFavorites,
  toggleFavorite,
} from '../src/features/markets/favorites';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import type { MarketAsset, QuoteDto } from '@marketpulse/contracts';
import { pollMarket } from '../src/features/markets/poll-market';
import { HistoryChart } from '../src/features/markets/HistoryChart';
import {
  MarketLoading,
  MarketPolicy,
  MarketSourcePolicy,
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
  loadAsset,
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
      { ...quote, provider: 'COINPAPRIKA', mode: 'REAL', simulated: false },
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
      cryptoMode="coinpaprika"
      cryptoSeconds={600}
      workerEnabled={false}
    />,
  );
  assert.match(policy, /simulated stock data/);
  assert.match(policy, /coinpaprika.com/);
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
  assert.match(
    html,
    /role="region" aria-label="Apple historical observations" tabindex="0"/,
  );
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

test('optional status failures do not hide valid prices on overview or detail; recovery restores diagnostics', async () => {
  const original = globalThis.fetch;
  try {
    for (const failure of [
      new Response('{}', { status: 500 }),
      new Response('{"cryptoMode":"broken"}'),
    ]) {
      globalThis.fetch = async (input) => {
        const path = String(input);
        if (path.includes('/market-status')) return failure.clone();
        return new Response(
          JSON.stringify(
            path.includes('/quotes')
              ? { quotes: [quote] }
              : path.includes(`/assets/${id}`)
                ? { asset: stock }
                : { assets: [stock], total: 1 },
          ),
        );
      };
      const overview = await loadOverview(new AbortController().signal);
      assert.equal(overview.quotes[0]?.price, quote.price);
      assert.equal(overview.status, null);
      const detail = await loadAsset(id, new AbortController().signal);
      assert.equal(detail.quote?.price, quote.price);
      assert.equal(detail.status, null);
      const html = renderToStaticMarkup(
        <MarketSourcePolicy status={overview.status} />,
      );
      assert.match(html, /Provider status temporarily unavailable/);
      assert.match(html, /Stocks use simulated data/);
      assert.doesNotMatch(html, /worker is disabled|Real crypto mode selected/);
    }
    globalThis.fetch = async (input) =>
      new Response(
        JSON.stringify(
          String(input).includes('/market-status')
            ? status
            : String(input).includes('/quotes')
              ? { quotes: [quote] }
              : { assets: [stock], total: 1 },
        ),
      );
    assert.equal(
      (await loadOverview(new AbortController().signal)).status?.cryptoMode,
      'demo',
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('essential quote failures still reject rather than invent prices', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input) =>
      String(input).includes('/quotes')
        ? new Response('{}', { status: 503 })
        : new Response(
            JSON.stringify(
              String(input).includes('/market-status')
                ? status
                : { assets: [stock], total: 1 },
            ),
          );
    await assert.rejects(
      () => loadOverview(new AbortController().signal),
      MarketRequestError,
    );
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <QuoteCard asset={stock} />
      </MemoryRouter>,
    );
    assert.match(html, /Simulated data/);
    assert.match(html, /Unavailable/);
  } finally {
    globalThis.fetch = original;
  }
});

test('CoinPaprika observations survive unavailable diagnostics without losing real provenance', async () => {
  const original = globalThis.fetch;
  const live = {
    ...quote,
    assetId: crypto.id,
    provider: 'COINPAPRIKA',
    mode: 'REAL',
    simulated: false,
    price: '65000.12',
  };
  try {
    globalThis.fetch = async (input) =>
      String(input).includes('/market-status')
        ? new Response('{}', { status: 503 })
        : new Response(
            JSON.stringify(
              String(input).includes('/quotes')
                ? { quotes: [live] }
                : { assets: [crypto], total: 1 },
            ),
          );
    const data = await loadOverview(new AbortController().signal);
    assert.deepEqual(data.quotes, [live]);
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <QuoteCard asset={crypto} quote={data.quotes[0]} />
      </MemoryRouter>,
    );
    assert.match(html, /COINPAPRIKA/);
    assert.match(html, /Real market data/);
    assert.doesNotMatch(html, /Simulated data/);
  } finally {
    globalThis.fetch = original;
  }
});

class Visibility extends EventTarget {
  hidden = false;
  change(hidden: boolean) {
    this.hidden = hidden;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

test('polling updates prices every minute, pauses hidden tabs, resumes and cleans up', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000 });
  const visibility = new Visibility();
  const received: number[] = [];
  let calls = 0;
  const stop = pollMarket(
    async () => ++calls,
    60_000,
    (value) => received.push(value),
    () => assert.fail('unexpected failure'),
    visibility,
  );
  try {
    await nextTurn();
    assert.deepEqual(received, [1]);
    context.mock.timers.tick(60_000);
    await nextTurn();
    assert.deepEqual(received, [1, 2]);
    visibility.change(true);
    context.mock.timers.tick(180_000);
    await nextTurn();
    assert.equal(calls, 2);
    visibility.change(false);
    await nextTurn();
    assert.deepEqual(received, [1, 2, 3]);
    stop();
    context.mock.timers.tick(120_000);
    await nextTurn();
    assert.equal(calls, 3);
  } finally {
    stop();
    context.mock.timers.reset();
  }
});

test('polling retains last result on failure, honors cooldown across tab changes and recovers', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000 });
  const visibility = new Visibility();
  const received: number[] = [];
  let calls = 0;
  let errors = 0;
  const stop = pollMarket(
    async () => {
      calls++;
      if (calls === 2) throw new MarketRequestError('Rate limited', 120_000);
      return calls;
    },
    60_000,
    (value) => received.push(value),
    () => errors++,
    visibility,
  );
  try {
    await nextTurn();
    context.mock.timers.tick(60_000);
    await nextTurn();
    assert.deepEqual(received, [1]);
    assert.equal(errors, 1);
    visibility.change(true);
    visibility.change(false);
    context.mock.timers.tick(119_999);
    await nextTurn();
    assert.equal(calls, 2);
    context.mock.timers.tick(1);
    await nextTurn();
    assert.deepEqual(received, [1, 3]);
  } finally {
    stop();
    context.mock.timers.reset();
  }
});

test('visibility changes never overlap requests and unmount aborts pending responses', async () => {
  const visibility = new Visibility();
  let calls = 0;
  let signal: AbortSignal | undefined;
  let resolve!: (value: number) => void;
  const received: number[] = [];
  const stop = pollMarket(
    (input) => {
      calls++;
      signal = input;
      return new Promise<number>((done) => {
        resolve = done;
      });
    },
    60_000,
    (value) => received.push(value),
    () => assert.fail('unexpected failure'),
    visibility,
  );
  visibility.change(true);
  visibility.change(false);
  visibility.change(false);
  assert.equal(calls, 1);
  stop();
  assert.equal(signal?.aborted, true);
  resolve(1);
  await nextTurn();
  assert.deepEqual(received, []);
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

test('favorites can be starred, restored after refresh, and unstarred without changing other selections', () => {
  let saved: string | null = null;
  const storage = {
    getItem: (key: string) => {
      assert.equal(key, favoritesStorageKey);
      return saved;
    },
    setItem: (key: string, value: string) => {
      assert.equal(key, favoritesStorageKey);
      saved = value;
    },
  };
  const original: string[] = [];
  const starred = toggleFavorite(
    toggleFavorite(original, stock.key),
    crypto.key,
  );
  assert.deepEqual(original, []);
  writeFavorites(storage, starred);
  const restored = readFavorites(storage);
  assert.deepEqual(restored, [stock.key, crypto.key]);
  writeFavorites(storage, toggleFavorite(restored, stock.key));
  assert.deepEqual(readFavorites(storage), [crypto.key]);
  writeFavorites(storage, toggleFavorite(readFavorites(storage), crypto.key));
  assert.deepEqual(readFavorites(storage), []);
});

test('favorites safely handle missing, malformed, and blocked storage', () => {
  for (const value of [null, '{', '{}', 'null', '123']) {
    assert.deepEqual(
      readFavorites({ getItem: () => value, setItem: () => {} }),
      [],
    );
  }
  assert.deepEqual(
    readFavorites({
      getItem: () => '["stock:aapl",null,4,"","stock:aapl"]',
      setItem: () => {},
    }),
    [stock.key],
  );
  const blocked = {
    getItem: (): string | null => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('quota');
    },
  };
  assert.deepEqual(readFavorites(blocked), []);
  assert.doesNotThrow(() => writeFavorites(blocked, [stock.key]));
});

test('favorites filter combines with search, type, and sorting', () => {
  const assets = [crypto, stock];
  assert.deepEqual(filterAssets(assets, '', 'ALL', 'name', [stock.key]), [
    stock,
  ]);
  assert.deepEqual(
    filterAssets(assets, ' APP ', 'STOCK', 'symbol', [stock.key]),
    [stock],
  );
  assert.deepEqual(
    filterAssets(assets, 'btc', 'ALL', 'symbol', [stock.key]),
    [],
  );
  assert.deepEqual(filterAssets(assets, '', 'CRYPTO', 'name', [stock.key]), []);
  assert.deepEqual(filterAssets(assets, '', 'ALL', 'name', []), []);
  assert.deepEqual(
    filterAssets(assets, '', 'ALL', 'name', [crypto.key, stock.key]),
    [stock, crypto],
  );
  assert.deepEqual(assets, [crypto, stock]);
});

test('favorite stars expose an accessible action and pressed state', () => {
  for (const selected of [false, true]) {
    const html = renderToStaticMarkup(
      <FavoriteButton name="Apple" selected={selected} onToggle={() => {}} />,
    );
    assert.match(html, new RegExp(`aria-pressed="${selected}"`));
    assert.match(
      html,
      new RegExp(
        selected ? 'Remove Apple from favorites' : 'Add Apple to favorites',
      ),
    );
    assert.match(html, /type="button"/);
    assert.match(html, selected ? /★/ : /☆/);
  }
});

test('detail range filters show requested labels mapped to supported API ranges', () => {
  assert.deepEqual(historyRanges, [
    { value: '1D', label: '24H' },
    { value: '7D', label: '7D' },
    { value: '1M', label: '30D' },
    { value: '1Y', label: '1Y' },
  ]);
  for (const range of historyRanges) {
    const html = renderToStaticMarkup(
      <HistoryRangeFilters range={range.value} onChange={() => {}} />,
    );
    assert.match(html, /aria-label="Historical range"/);
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.match(
      html,
      new RegExp(`aria-pressed="true">${range.label}</button>`),
    );
  }
});

test('asset information shows catalog facts and clearly identifies simulated stocks', () => {
  const html = renderToStaticMarkup(<AssetInformation asset={stock} />);
  for (const value of [
    'About Apple',
    'AAPL',
    'Stock',
    'NASDAQ',
    'USD',
    'Simulated data only',
  ]) {
    assert.ok(html.includes(value));
  }
  const real = renderToStaticMarkup(<AssetInformation asset={crypto} />);
  assert.match(real, /Crypto market/);
  assert.match(real, /Real data where available/);
  assert.doesNotMatch(real, /Simulated data only/);
});

test('chart pointer selection uses observation times including irregular samples and endpoints', () => {
  const points = [{ time: 0 }, { time: 10 }, { time: 1000 }];
  assert.equal(nearestObservation([], 5), null);
  assert.equal(nearestObservation(points, -20), 0);
  assert.equal(nearestObservation(points, 15), 1);
  assert.equal(nearestObservation(points, 700), 2);
  assert.equal(nearestObservation(points, 2000), 2);
  assert.equal(nearestObservation([{ time: 1 }], 10), 0);
});

test('range summaries calculate observed low, high, and change without inventing missing samples', () => {
  assert.equal(historySummary([]), null);
  assert.deepEqual(
    historySummary([{ value: 100 }, { value: 80 }, { value: 120 }]),
    {
      low: 80,
      high: 120,
      changePercent: 20,
    },
  );
  assert.deepEqual(historySummary([{ value: 100 }, { value: 75 }]), {
    low: 75,
    high: 100,
    changePercent: -25,
  });
  assert.deepEqual(historySummary([{ value: 10 }]), {
    low: 10,
    high: 10,
    changePercent: 0,
  });
});

test('real historical charts retain source attribution, interactive controls, and range statistics', () => {
  const now = Date.now();
  const html = renderToStaticMarkup(
    <HistoryChart
      name="Bitcoin"
      history={{
        ...history,
        assetId: crypto.id,
        provider: 'COINPAPRIKA',
        mode: 'REAL',
        simulated: false,
        range: '7D',
        points: [
          { timestamp: new Date(now - 86400_000).toISOString(), price: '100' },
          { timestamp: new Date(now).toISOString(), price: '120' },
        ],
      }}
    />,
  );
  assert.match(html, /Real market data/);
  assert.match(html, /COINPAPRIKA/);
  assert.match(html, /coinpaprika.com/);
  assert.match(html, /Range low/);
  assert.match(html, /Range high/);
  assert.match(html, /\+20.00%/);
  assert.match(html, /type="range"/);
  assert.match(html, /aria-valuetext=/);
  assert.match(html, /Coverage may be shorter/);
  assert.doesNotMatch(html, /Simulated data/);
});

test('market resources expose retry progress, retain cached observations, and clear errors on recovery', () => {
  const request = async () => 1;
  let state = initialResourceState(request);
  assert.equal(state.loading, true);
  state = resourceReducer(state, {
    type: 'failure',
    request,
    error: 'Offline',
  });
  assert.equal(state.loading, false);
  assert.equal(state.error, 'Offline');
  state = resourceReducer(state, { type: 'start', request });
  assert.equal(state.loading, true);
  assert.equal(state.error, null);
  state = resourceReducer(state, {
    type: 'success',
    request,
    data: 1,
    checkedAt: timestamp,
  });
  state = resourceReducer(state, { type: 'start', request });
  assert.equal(state.loading, true);
  assert.equal(state.data, 1);
  assert.equal(state.checkedAt, timestamp);
  state = resourceReducer(state, {
    type: 'failure',
    request,
    error: 'Unavailable',
  });
  assert.equal(state.data, 1);
  assert.equal(state.checkedAt, timestamp);
  assert.equal(state.loading, false);
  state = resourceReducer(state, {
    type: 'success',
    request,
    data: 2,
    checkedAt: 'new check',
  });
  assert.equal(state.data, 2);
  assert.equal(state.error, null);
  assert.equal(state.checkedAt, 'new check');
  const otherRequest = async () => 3;
  state = resourceReducer(state, { type: 'start', request: otherRequest });
  assert.equal(state.loading, true);
  assert.equal(state.data, null);
  assert.equal(state.checkedAt, null);
});

test('polling reports progress only for real requests, respects hidden tabs and cooldown, and stops after cleanup', async (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const visibility = new Visibility();
  visibility.hidden = true;
  const events: string[] = [];
  let calls = 0;
  const stop = pollMarket(
    async () => {
      events.push('request');
      if (++calls === 1) throw new MarketRequestError('Rate limited', 120_000);
      return 1;
    },
    60_000,
    () => events.push('success'),
    () => events.push('failure'),
    visibility,
    () => events.push('start'),
  );
  try {
    assert.deepEqual(events, []);
    visibility.change(false);
    await nextTurn();
    assert.deepEqual(events, ['start', 'request', 'failure']);
    visibility.change(true);
    visibility.change(false);
    context.mock.timers.tick(119_999);
    await nextTurn();
    assert.equal(events.length, 3);
    context.mock.timers.tick(1);
    await nextTurn();
    assert.deepEqual(events, [
      'start',
      'request',
      'failure',
      'start',
      'request',
      'success',
    ]);
    stop();
    context.mock.timers.tick(120_000);
    await nextTurn();
    assert.equal(events.length, 6);
  } finally {
    stop();
    context.mock.timers.reset();
  }
});

test('loading status distinguishes first load from a refresh with cached observations', () => {
  const initial = renderToStaticMarkup(<MarketLoading />);
  assert.match(initial, /role="status"/);
  assert.match(initial, /Loading the latest cached observations/);
  const refreshing = renderToStaticMarkup(<MarketLoading refreshing />);
  assert.match(refreshing, /role="status"/);
  assert.match(refreshing, /is-refreshing/);
  assert.match(refreshing, /Refreshing cached observations/);
  assert.match(refreshing, /aria-hidden="true"/);
});
