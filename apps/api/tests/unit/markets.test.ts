import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createCoinPaprikaProvider,
  retryAfter,
} from '../../src/providers/coinpaprika-provider.js';
import { demoProvider } from '../../src/providers/demo-provider.js';
import type { MarketProvider } from '../../src/providers/market-provider.js';
import { marketSettingsSchema } from '../../src/config/markets.js';
import {
  createMarketEngine,
  budgetWindows,
} from '../../src/modules/markets/engine.js';
import { createMarketService } from '../../src/modules/markets/service.js';
import {
  ProviderFailure,
  type Source,
} from '../../src/modules/markets/types.js';
import { createApp } from '../../src/app.js';
import type { AuthService } from '../../src/modules/auth/service.js';
import { request } from '../helpers/http.js';
import { memoryStore } from '../helpers/market-store.js';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const demo = marketSettingsSchema.parse({ CRYPTO_DATA_MODE: 'demo' });
function real(overrides = {}) {
  return marketSettingsSchema.parse({
    CRYPTO_DATA_MODE: 'coinpaprika',
    ...overrides,
  });
}
function ticker(
  id: string,
  price: number | null = 123.45,
  percent: number | null = 1.5,
  time = NOW - 60_000,
) {
  return {
    id,
    last_updated: new Date(time).toISOString(),
    quotes: { USD: { price, percent_change_24h: percent } },
  };
}
function liveTickers(fixture: ReturnType<typeof memoryStore>) {
  return fixture.assets
    .slice(0, 10)
    .map((asset) =>
      ticker(
        asset.mappings.find((mapping) => mapping.provider === 'COINPAPRIKA')!
          .externalId,
      ),
    );
}
function clock() {
  const time = { value: NOW };
  return {
    time,
    now: () => time.value,
    async sleep(ms: number) {
      time.value += ms;
    },
    random: () => 0,
  };
}
function providers(provider: MarketProvider = demoProvider) {
  return new Map<Source, MarketProvider>([
    [provider.source, provider],
    ['DEMO', demoProvider],
  ]);
}

test('synthetic quotes/history are deterministic, decimal strings, bounded and never labeled real', async () => {
  const { assets } = memoryStore();
  const first = await demoProvider.quotes(assets, NOW);
  assert.deepEqual(await demoProvider.quotes(assets, NOW), first);
  assert.equal(first.length, 15);
  assert.ok(first.every((row) => /^\d+\.\d{18}$/.test(row.price)));
  for (const range of ['1D', '7D', '1M', '1Y'] as const) {
    const points = await demoProvider.history(assets[0]!, range, NOW);
    assert.ok(points.length > 1 && points.length <= 721);
    assert.ok(
      points.every(
        (row, index) =>
          row.timestamp <= NOW &&
          (!index || row.timestamp > points[index - 1]!.timestamp),
      ),
    );
  }
});

test('CoinPaprika uses one keyless free-host batch, preserves source time and ignores unusable or unrelated rows', async () => {
  const asset = memoryStore().assets[0]!;
  let calls = 0;
  const provider = createCoinPaprikaProvider(async (input, options) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.coinpaprika.com');
    assert.equal(url.pathname, '/v1/tickers');
    assert.equal(url.search, '?quotes=USD');
    assert.equal(options?.headers, undefined);
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal);
    return Response.json([
      ticker('btc-bitcoin', 123.5, null),
      { id: 'unrelated', quotes: {} },
    ]);
  });
  const result = await provider.quotes([asset], NOW);
  assert.equal(calls, 1);
  assert.equal(result[0]?.price, '123.500000000000000000');
  assert.equal(result[0]?.sourceAt, NOW - 60_000);
  assert.equal(result[0]?.changePercent, null);
  const invalid = createCoinPaprikaProvider(async () =>
    Response.json([{ ...ticker('btc-bitcoin'), last_updated: null }]),
  );
  await assert.rejects(
    () => invalid.quotes([asset], NOW),
    (error: unknown) =>
      error instanceof ProviderFailure && error.reason === 'invalid_data',
  );
});

test('free history uses hourly one-day and daily longer ranges, sorts/deduplicates and handles safe errors', async () => {
  const asset = memoryStore().assets[0]!;
  const provider = createCoinPaprikaProvider(async (input, options) => {
    const url = new URL(String(input));
    assert.equal(options?.headers, undefined);
    assert.equal(url.origin, 'https://api.coinpaprika.com');
    assert.equal(url.pathname, '/v1/tickers/btc-bitcoin/historical');
    assert.ok(['1h', '24h'].includes(url.searchParams.get('interval')!));
    assert.equal(url.searchParams.get('quote'), 'usd');
    return Response.json([
      { timestamp: new Date(NOW).toISOString(), price: 2 },
      { timestamp: new Date(NOW - 3600_000).toISOString(), price: 1 },
      { timestamp: new Date(NOW).toISOString(), price: 3 },
    ]);
  });
  for (const range of ['1D', '7D', '1M', '1Y'] as const)
    assert.deepEqual(
      (await provider.history(asset, range, NOW)).map((row) => row.price),
      ['1.000000000000000000', '3.000000000000000000'],
    );
  for (const [status, reason] of [
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [402, 'rate_limited'],
    [429, 'rate_limited'],
    [503, 'upstream_error'],
  ] as const) {
    const failed = createCoinPaprikaProvider(
      async () =>
        new Response('PRIVATE upstream details', {
          status,
          headers: { 'Retry-After': '120' },
        }),
    );
    await assert.rejects(
      () => failed.quotes([asset], NOW),
      (error: unknown) =>
        error instanceof ProviderFailure &&
        error.reason === reason &&
        !error.message.includes('PRIVATE'),
    );
  }
  assert.equal(retryAfter('120', NOW), NOW + 120_000);
  assert.equal(
    retryAfter(new Date(NOW + 180_000).toUTCString(), NOW),
    NOW + 180_000,
  );
  assert.equal(retryAfter('invalid', NOW), NOW + 60_000);
});

test('many clients share one batch, quotes read cache only, and restart preserves the cooldown', async () => {
  const fixture = memoryStore();
  const timer = clock();
  let calls = 0;
  const provider: MarketProvider = {
    ...demoProvider,
    async quotes(assets, now) {
      calls++;
      return demoProvider.quotes(assets, now);
    },
  };
  const service = createMarketService(fixture.store, demo, () => {}, timer.now);
  const initial = await Promise.all(
    Array.from({ length: 20 }, () => service.quotes()),
  );
  assert.ok(
    initial.every((result) =>
      result.quotes.every((quote) => quote.status === 'unavailable'),
    ),
  );
  assert.equal(calls, 0);
  await Promise.all(
    Array.from({ length: 20 }, () =>
      createMarketEngine(
        fixture.store,
        new Map([['DEMO', provider]]),
        demo,
        timer,
      ).tick(),
    ),
  );
  assert.equal(calls, 1);
  assert.ok(
    (await service.quotes()).quotes.every(
      (row) => row.status === 'fresh' && row.simulated,
    ),
  );
  await createMarketEngine(
    fixture.store,
    new Map([['DEMO', provider]]),
    demo,
    timer,
  ).tick();
  assert.equal(calls, 1);
});

test('timeouts retry within quota and stale real observations never switch to demo', async () => {
  const fixture = memoryStore();
  const timer = clock();
  let calls = 0;
  const asset = fixture.assets[0]!;
  await fixture.store.saveQuotes([
    {
      assetId: asset.id,
      provider: 'COINPAPRIKA',
      mode: 'REAL',
      price: '123',
      changePercent: null,
      sourceAt: NOW - 21 * 60_000,
      fetchedAt: NOW,
    },
    {
      assetId: asset.id,
      provider: 'DEMO',
      mode: 'DEMO',
      price: '999',
      changePercent: null,
      sourceAt: NOW,
      fetchedAt: NOW,
    },
  ]);
  const provider = createCoinPaprikaProvider(async () => {
    calls++;
    throw new Error('network down');
  });
  await createMarketEngine(
    fixture.store,
    providers(provider),
    real(),
    timer,
  ).tick();
  assert.equal(calls, 3);
  const quote = (
    await createMarketService(
      fixture.store,
      real(),
      () => {},
      timer.now,
    ).quotes([asset.id])
  ).quotes[0]!;
  assert.equal(quote.status, 'stale');
  assert.equal(quote.price, '123');
  assert.equal(quote.simulated, false);
  assert.equal(quote.provider, 'COINPAPRIKA');
  const windows = budgetWindows(real(), timer.now(), 'quotes');
  assert.equal(
    (await fixture.store.usage('COINPAPRIKA', windows)).find(
      (row) => row.category === 'all:month',
    )?.used,
    3,
  );
});

test('429 pauses without a retry storm and unauthorized providers remain disabled after restart', async () => {
  for (const code of [429, 401]) {
    const fixture = memoryStore();
    const timer = clock();
    let calls = 0;
    const provider = createCoinPaprikaProvider(async () => {
      calls++;
      return new Response('', {
        status: code,
        headers: { 'Retry-After': '1200' },
      });
    });
    await createMarketEngine(
      fixture.store,
      providers(provider),
      real(),
      timer,
    ).tick();
    assert.equal(calls, 1);
    timer.time.value += 601_000;
    await createMarketEngine(
      fixture.store,
      providers(provider),
      real(),
      timer,
    ).tick();
    assert.equal(calls, 1);
    assert.equal(fixture.states.get('COINPAPRIKA')?.disabled, code === 401);
  }
});

test('exhausted windows stop requests atomically and monthly windows follow UTC without account configuration', async () => {
  const fixture = memoryStore();
  const timer = clock();
  let calls = 0;
  const settings = real({ CP_MONTHLY_ATTEMPT_LIMIT: '1' });
  const windows = budgetWindows(settings, NOW, 'quotes');
  await fixture.store.reserve('COINPAPRIKA', windows);
  await fixture.store.settle('COINPAPRIKA', windows);
  const provider = createCoinPaprikaProvider(async () => {
    calls++;
    return Response.json([]);
  });
  await createMarketEngine(
    fixture.store,
    providers(provider),
    settings,
    timer,
  ).tick();
  assert.equal(calls, 0);
  assert.ok(
    (await fixture.store.usage('COINPAPRIKA', windows)).every(
      (row) => row.used === 1,
    ),
  );
  assert.throws(() => budgetWindows(demo, NOW, 'quotes'), /demo_mode/);
  const next = budgetWindows(
    settings,
    Date.parse('2026-12-02T00:00:00Z'),
    'quotes',
  ).find((window) => window.category === 'all:month')!;
  assert.equal(next.start, Date.parse('2026-12-01T00:00:00Z'));
  assert.equal(next.end, Date.parse('2027-01-01T00:00:00Z'));
});

test('history misses coalesce, retain stale data, expire after 48 hours and queue a refresh', async () => {
  const fixture = memoryStore();
  const timer = clock();
  let calls = 0;
  const provider: MarketProvider = {
    ...demoProvider,
    async history(asset, range, now) {
      calls++;
      return demoProvider.history(asset, range, now);
    },
  };
  const service = createMarketService(fixture.store, demo, () => {}, timer.now);
  const id = fixture.assets[0]!.id;
  const pending = await Promise.all(
    Array.from({ length: 20 }, () => service.history(id, '1D')),
  );
  assert.ok(pending.every((result) => result.status === 202));
  assert.equal(fixture.histories.size, 1);
  assert.equal(calls, 0);
  await createMarketEngine(
    fixture.store,
    new Map([['DEMO', provider]]),
    demo,
    timer,
  ).tick();
  assert.equal(calls, 1);
  assert.equal((await service.history(id, '1D')).body.status, 'fresh');
  timer.time.value += 31 * 60_000;
  const stale = await service.history(id, '1D');
  assert.equal(stale.status, 200);
  assert.equal(stale.body.status, 'stale');
  assert.ok(stale.body.points.length);
  timer.time.value += 49 * 3600_000;
  const expired = await service.history(id, '1D');
  assert.equal(expired.status, 202);
  assert.deepEqual(expired.body.points, []);
});

test('circuit breaker allows just one recovery probe after repeated transient failures', async () => {
  const fixture = memoryStore();
  const timer = clock();
  let calls = 0;
  const provider = createCoinPaprikaProvider(async () => {
    calls++;
    return new Response('', { status: 503 });
  });
  for (let index = 0; index < 3; index++) {
    await createMarketEngine(
      fixture.store,
      providers(provider),
      real(),
      timer,
    ).tick();
    timer.time.value += 601_000;
  }
  assert.equal(calls, 9);
  await createMarketEngine(
    fixture.store,
    providers(provider),
    real(),
    timer,
  ).tick();
  assert.equal(calls, 10);
});

test('REST validates filters/ranges/IDs, hides provider mappings and returns explicit pending/demo status', async () => {
  const fixture = memoryStore();
  const market = createMarketService(
    fixture.store,
    demo,
    () => {},
    () => NOW,
  );
  const auth = { limit: async () => {} } as unknown as AuthService;
  const app = createApp(
    auth,
    {
      origin: 'http://localhost:5173',
      secret: 'a'.repeat(64),
      secure: false,
      ttlSeconds: 3600,
    },
    market,
  );
  const assets = await request(app, 'GET', '/api/v1/assets?type=STOCK&q=Apple');
  assert.equal(assets.status, 200);
  assert.equal(assets.body.total, 1);
  assert.ok(!JSON.stringify(assets.body).includes('mappings'));
  assert.equal(
    (await request(app, 'GET', '/api/v1/assets/not-a-uuid')).status,
    400,
  );
  assert.equal(
    (
      await request(
        app,
        'GET',
        `/api/v1/assets/${fixture.assets[0]!.id}/history?range=2Y`,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        app,
        'GET',
        '/api/v1/assets?providerUrl=https://untrusted.example',
      )
    ).status,
    400,
  );
  const history = await request(
    app,
    'GET',
    `/api/v1/assets/${fixture.assets[0]!.id}/history`,
  );
  assert.equal(history.status, 202);
  assert.equal(history.body.simulated, true);
  assert.equal(history.body.refresh, 'pending');
  const status = await request(app, 'GET', '/api/v1/market-status');
  assert.equal(status.status, 200);
  assert.ok(!JSON.stringify(status.body).includes('synthetic-secret'));
});

test('a late history reader cannot requeue or hide a concurrently completed refresh', async () => {
  const fixture = memoryStore();
  const enqueue = fixture.store.enqueue;
  fixture.store.enqueue = async (key, now) => {
    await fixture.store.saveHistory(
      key,
      [{ timestamp: now, price: '123.000000000000000000' }],
      now,
      1800_000,
    );
    await enqueue(key, now);
  };
  const result = await createMarketService(
    fixture.store,
    demo,
    () => {},
    () => NOW,
  ).history(fixture.assets[0]!.id, '1D');
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'fresh');
  assert.equal(result.body.refresh, 'idle');
  assert.equal(result.body.points.length, 1);
});

test('real ingestion serves crypto quotes and charts without touching stock demo mode or old demo caches', async () => {
  const fixture = memoryStore();
  const timer = clock();
  const asset = fixture.assets[0]!;
  await fixture.store.saveQuotes(
    (await demoProvider.quotes(fixture.assets, NOW)).map((quote) => ({
      ...quote,
      provider: 'DEMO',
      mode: 'DEMO',
      fetchedAt: NOW,
    })),
  );
  await fixture.store.saveHistory(
    { assetId: asset.id, provider: 'DEMO', mode: 'DEMO', range: '1D' },
    [{ timestamp: NOW, price: '999' }],
    NOW,
    1800_000,
  );
  let calls = 0;
  const provider = createCoinPaprikaProvider(async (input, options) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.coinpaprika.com');
    assert.equal(options?.headers, undefined);
    if (url.pathname === '/v1/tickers')
      return Response.json(liveTickers(fixture));
    assert.equal(url.pathname, '/v1/tickers/btc-bitcoin/historical');
    assert.equal(url.searchParams.get('interval'), '1h');
    return Response.json([
      { timestamp: new Date(NOW - 3600_000).toISOString(), price: 122 },
      { timestamp: new Date(NOW).toISOString(), price: 123.45 },
    ]);
  });
  const service = createMarketService(
    fixture.store,
    real(),
    () => {},
    timer.now,
  );
  const cold = (await service.quotes()).quotes;
  assert.ok(
    cold
      .slice(0, 10)
      .every(
        (quote) =>
          quote.provider === 'COINPAPRIKA' &&
          !quote.simulated &&
          quote.price === null,
      ),
  );
  assert.ok(
    cold
      .slice(10)
      .every((quote) => quote.provider === 'DEMO' && quote.simulated),
  );
  const pending = await service.history(asset.id, '1D');
  assert.equal(pending.status, 202);
  assert.deepEqual(pending.body.points, []);
  await createMarketEngine(
    fixture.store,
    providers(provider),
    real(),
    timer,
  ).tick();
  assert.equal(calls, 2);
  const live = (await service.quotes()).quotes;
  assert.ok(
    live
      .slice(0, 10)
      .every(
        (quote) =>
          quote.status === 'fresh' &&
          quote.mode === 'REAL' &&
          !quote.simulated &&
          quote.price === '123.450000000000000000',
      ),
  );
  assert.ok(
    live.slice(10).every((quote) => quote.mode === 'DEMO' && quote.simulated),
  );
  const chart = await service.history(asset.id, '1D');
  assert.equal(chart.status, 200);
  assert.equal(chart.body.provider, 'COINPAPRIKA');
  assert.equal(chart.body.simulated, false);
  assert.equal(chart.body.sourceAt, new Date(NOW).toISOString());
  assert.equal(chart.body.points.at(-1)?.price, '123.450000000000000000');
  for (let reader = 0; reader < 10; reader++) {
    await service.quotes();
    await service.history(asset.id, '1D');
  }
  assert.equal(calls, 2);
  const status = await service.status();
  assert.equal(
    status.providers.find((row) => row.provider === 'COINPAPRIKA')?.quoteReason,
    null,
  );
  assert.ok(!JSON.stringify(status).includes('synthetic-secret'));
});

test('default live crypto works without keys, subscriptions, enable flags or billing windows', async () => {
  const fixture = memoryStore();
  const timer = clock();
  let calls = 0;
  const settings = marketSettingsSchema.parse({});
  assert.equal(settings.CRYPTO_DATA_MODE, 'coinpaprika');
  const provider = createCoinPaprikaProvider(async (_input, options) => {
    calls++;
    assert.equal(options?.headers, undefined);
    return Response.json(liveTickers(fixture));
  });
  await createMarketEngine(
    fixture.store,
    providers(provider),
    settings,
    timer,
  ).tick();
  assert.equal(calls, 1);
  const service = createMarketService(
    fixture.store,
    settings,
    () => {},
    timer.now,
  );
  const quotes = (await service.quotes()).quotes;
  assert.ok(
    quotes
      .slice(0, 10)
      .every(
        (quote) =>
          quote.status === 'fresh' &&
          quote.provider === 'COINPAPRIKA' &&
          !quote.simulated,
      ),
  );
  assert.ok(
    quotes
      .slice(10)
      .every((quote) => quote.status === 'fresh' && quote.simulated),
  );
  assert.equal(
    (await service.status()).providers.find(
      (row) => row.provider === 'COINPAPRIKA',
    )?.quoteReason,
    null,
  );
});

test('chart-only quota exhaustion does not label quote updates blocked; global exhaustion blocks both', async () => {
  const fixture = memoryStore();
  const settings = real({
    CP_CHART_DAILY_LIMIT: '1',
    CP_MONTHLY_ATTEMPT_LIMIT: '2',
  });
  const charts = budgetWindows(settings, NOW, 'history');
  await fixture.store.reserve('COINPAPRIKA', charts);
  await fixture.store.settle('COINPAPRIKA', charts);
  const service = createMarketService(
    fixture.store,
    settings,
    () => {},
    () => NOW,
  );
  let status = (await service.status()).providers.find(
    (row) => row.provider === 'COINPAPRIKA',
  )!;
  assert.equal(status.quoteReason, null);
  assert.equal(status.historyReason, 'quota_exhausted');
  const quotes = budgetWindows(settings, NOW, 'quotes');
  await fixture.store.reserve('COINPAPRIKA', quotes);
  await fixture.store.settle('COINPAPRIKA', quotes);
  status = (await service.status()).providers.find(
    (row) => row.provider === 'COINPAPRIKA',
  )!;
  assert.equal(status.quoteReason, 'quota_exhausted');
  assert.equal(status.historyReason, 'quota_exhausted');
  assert.equal(
    status.budgets.find((row) => row.category === 'all:month')?.remaining,
    0,
  );
});

test('freshly fetched history with old source observations is stale for every supported range', async () => {
  const fixture = memoryStore();
  const asset = fixture.assets[0]!;
  const sourceAges = {
    '1D': 2 * 3600_000,
    '7D': 48 * 3600_000,
    '1M': 48 * 3600_000,
    '1Y': 48 * 3600_000,
  } as const;
  const service = createMarketService(
    fixture.store,
    real(),
    () => {},
    () => NOW,
  );
  for (const range of ['1D', '7D', '1M', '1Y'] as const) {
    const key = {
      assetId: asset.id,
      provider: 'COINPAPRIKA' as const,
      mode: 'REAL' as const,
      range,
    };
    await fixture.store.saveHistory(
      key,
      [{ timestamp: NOW - sourceAges[range] - 1, price: '123' }],
      NOW,
      24 * 3600_000,
    );
    let result = await service.history(asset.id, range);
    assert.equal(result.body.status, 'stale');
    assert.equal(result.body.reason, 'stale_observation');
    assert.equal(result.body.fetchedAt, new Date(NOW).toISOString());
    assert.equal(result.body.simulated, false);
    assert.equal(result.body.points[0]?.price, '123');
    // No repeated provider jobs just because the upstream source is behind.
    assert.equal(result.body.refresh, 'idle');
    await fixture.store.saveHistory(
      key,
      [{ timestamp: NOW, price: '124' }],
      NOW,
      1800_000,
    );
    result = await service.history(asset.id, range);
    assert.equal(result.body.status, 'fresh');
    assert.ok(result.body.freshUntil);
    assert.ok(result.body.expiresAt);
  }
});

test('live history failure retains stale real points and never substitutes an existing demo series', async () => {
  const fixture = memoryStore();
  const timer = clock();
  const asset = fixture.assets[0]!;
  const key = {
    assetId: asset.id,
    provider: 'COINPAPRIKA' as const,
    mode: 'REAL' as const,
    range: '1D' as const,
  };
  await fixture.store.saveHistory(
    key,
    [{ timestamp: NOW - 3600_000, price: '123' }],
    NOW - 3600_000,
    1800_000,
  );
  await fixture.store.saveHistory(
    { ...key, provider: 'DEMO', mode: 'DEMO' },
    [{ timestamp: NOW, price: '999' }],
    NOW,
    1800_000,
  );
  const service = createMarketService(
    fixture.store,
    real(),
    () => {},
    timer.now,
  );
  await service.history(asset.id, '1D');
  const provider = createCoinPaprikaProvider(
    async () => new Response('synthetic-secret upstream body', { status: 401 }),
  );
  await createMarketEngine(
    fixture.store,
    providers(provider),
    real(),
    timer,
  ).tick();
  const result = await service.history(asset.id, '1D');
  assert.equal(result.body.status, 'stale');
  assert.equal(result.body.provider, 'COINPAPRIKA');
  assert.equal(result.body.reason, 'unauthorized');
  assert.deepEqual(
    result.body.points.map((point) => point.price),
    ['123'],
  );
  const status = (await service.status()).providers.find(
    (row) => row.provider === 'COINPAPRIKA',
  )!;
  assert.equal(status.quoteReason, 'unauthorized');
  assert.equal(status.historyReason, 'unauthorized');
  assert.ok(!JSON.stringify(status).includes('synthetic-secret'));
});

test('CoinPaprika cannot ingest stocks or bypass approved application limits', async () => {
  let calls = 0;
  const provider = createCoinPaprikaProvider(async () => {
    calls++;
    return Response.json([]);
  });
  await assert.rejects(
    () => provider.quotes([memoryStore().assets[10]!], NOW),
    (error: unknown) =>
      error instanceof ProviderFailure && error.reason === 'invalid_data',
  );
  assert.equal(calls, 0);
  for (const config of [
    { CP_MONTHLY_ATTEMPT_LIMIT: 8001 },
    { CP_DAILY_ATTEMPT_LIMIT: 261 },
    { CP_MINUTE_ATTEMPT_LIMIT: 11 },
    { CP_CHART_DAILY_LIMIT: 81 },
    { STOCK_DATA_MODE: 'coinpaprika' },
  ])
    assert.equal(marketSettingsSchema.safeParse(config).success, false);
});

test('free-history restrictions and empty data back off durably without disabling quote ingestion', async () => {
  for (const status of [402, 403, 404, 200]) {
    const fixture = memoryStore();
    const timer = clock();
    const asset = fixture.assets[0]!;
    const service = createMarketService(
      fixture.store,
      real(),
      () => {},
      timer.now,
    );
    await fixture.store.saveHistory(
      { assetId: asset.id, provider: 'DEMO', mode: 'DEMO', range: '1M' },
      [{ timestamp: NOW, price: '999' }],
      NOW,
      1800_000,
    );
    await service.history(asset.id, '1M');
    let historyCalls = 0;
    let quoteCalls = 0;
    const provider = createCoinPaprikaProvider(async (input, options) => {
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://api.coinpaprika.com');
      assert.equal(options?.headers, undefined);
      if (url.pathname === '/v1/tickers') {
        quoteCalls++;
        return Response.json(liveTickers(fixture));
      }
      historyCalls++;
      assert.equal(url.searchParams.get('interval'), '24h');
      return status === 200
        ? Response.json([])
        : new Response('upgrade or private upstream text', { status });
    });
    const engine = createMarketEngine(
      fixture.store,
      providers(provider),
      real(),
      timer,
    );
    await engine.tick();
    let result = await service.history(asset.id, '1M');
    assert.equal(result.status, 202);
    assert.equal(result.body.reason, 'history_unavailable');
    assert.deepEqual(result.body.points, []);
    assert.equal(result.body.provider, 'COINPAPRIKA');
    assert.equal(result.body.granularity, '1d');
    assert.equal(result.body.simulated, false);
    assert.equal((await fixture.store.state('COINPAPRIKA')).disabled, false);
    assert.equal(
      (await service.status()).providers.find(
        (row) => row.provider === 'COINPAPRIKA',
      )?.quoteReason,
      null,
    );
    timer.time.value += 601_000;
    await engine.tick();
    assert.equal(historyCalls, 1);
    assert.equal(quoteCalls, 2);
    result = await service.history(asset.id, '1M');
    assert.equal(result.body.reason, 'history_unavailable');
  }
});

test('free history sends only entitled resolutions and validates real timestamps', async () => {
  const intervals: string[] = [];
  const asset = memoryStore().assets[0]!;
  const provider = createCoinPaprikaProvider(async (input) => {
    const url = new URL(String(input));
    intervals.push(url.searchParams.get('interval')!);
    assert.ok(
      Number(url.searchParams.get('start')) >=
        Math.floor((NOW - 365 * 86400_000) / 1000),
    );
    return Response.json([
      { timestamp: new Date(NOW).toISOString(), price: 12 },
    ]);
  });
  for (const range of ['1D', '7D', '1M', '1Y'] as const)
    await provider.history(asset, range, NOW);
  assert.deepEqual(intervals, ['1h', '24h', '24h', '24h']);
  for (const timestamp of ['invalid', new Date(NOW + 61_000).toISOString()]) {
    const invalid = createCoinPaprikaProvider(async () =>
      Response.json([{ timestamp, price: 12 }]),
    );
    await assert.rejects(
      () => invalid.history(asset, '1D', NOW),
      (error: unknown) =>
        error instanceof ProviderFailure && error.reason === 'invalid_data',
    );
  }
});

test('partial free ticker batches preserve missing observations and reject invalid provider mapping paths', async () => {
  const fixture = memoryStore();
  const provider = createCoinPaprikaProvider(async () =>
    Response.json([ticker('btc-bitcoin', 123), ticker('eth-ethereum', null)]),
  );
  const rows = await provider.quotes(fixture.assets.slice(0, 2), NOW);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.assetId, fixture.assets[0]!.id);
  let calls = 0;
  const guarded = createCoinPaprikaProvider(async () => {
    calls++;
    return Response.json([]);
  });
  await assert.rejects(
    () =>
      guarded.quotes(
        [
          {
            ...fixture.assets[0]!,
            mappings: [{ provider: 'COINPAPRIKA', externalId: '../key/info' }],
          },
        ],
        NOW,
      ),
    ProviderFailure,
  );
  assert.equal(calls, 0);
});
