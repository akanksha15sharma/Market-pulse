import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createCoinGeckoProvider,
  retryAfter,
} from '../../src/providers/coingecko-provider.js';
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
const demo = marketSettingsSchema.parse({});
function real(overrides = {}) {
  return marketSettingsSchema.parse({
    CRYPTO_DATA_MODE: 'coingecko',
    COINGECKO_LIVE_ENABLED: 'true',
    COINGECKO_API_KEY: 'synthetic-secret',
    CG_BILLING_START: '2026-11-01T00:00:00Z',
    CG_BILLING_END: '2026-12-01T00:00:00Z',
    ...overrides,
  });
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

test('CoinGecko batches at a fixed origin, preserves source time, and rejects unknown or invalid observations', async () => {
  const { assets } = memoryStore();
  const asset = assets[0]!;
  let calls = 0;
  const provider = createCoinGeckoProvider(
    'synthetic-secret',
    async (url, options) => {
      calls++;
      assert.equal(new URL(String(url)).origin, 'https://api.coingecko.com');
      assert.equal(options?.redirect, 'error');
      assert.equal(
        (options?.headers as Record<string, string>)['x-cg-demo-api-key'],
        'synthetic-secret',
      );
      assert.ok(options?.signal);
      return Response.json([
        {
          id: 'bitcoin',
          current_price: 123.5,
          price_change_percentage_24h: null,
          last_updated: new Date(NOW - 60_000).toISOString(),
        },
        { id: 'not-requested', current_price: 3, last_updated: null },
      ]);
    },
  );
  const result = await provider.quotes([asset], NOW);
  assert.equal(calls, 1);
  assert.equal(result[0]?.price, '123.500000000000000000');
  assert.equal(result[0]?.sourceAt, NOW - 60_000);
  const invalid = createCoinGeckoProvider('key', async () =>
    Response.json([{ id: 'bitcoin', current_price: 1, last_updated: null }]),
  );
  await assert.rejects(
    () => invalid.quotes([asset], NOW),
    (error: unknown) =>
      error instanceof ProviderFailure && error.reason === 'invalid_data',
  );
});

test('provider history normalizes duplicate timestamps; errors/Retry-After never expose keys or response bodies', async () => {
  const asset = memoryStore().assets[0]!;
  const history = createCoinGeckoProvider('key', async () =>
    Response.json({
      prices: [
        [NOW, 2],
        [NOW - 300_000, 1],
        [NOW, 3],
      ],
    }),
  );
  assert.deepEqual(
    (await history.history(asset, '1D', NOW)).map((row) => row.price),
    ['1.000000000000000000', '3.000000000000000000'],
  );
  for (const [status, reason] of [
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [429, 'rate_limited'],
    [503, 'upstream_error'],
  ] as const) {
    const provider = createCoinGeckoProvider(
      'SECRET',
      async () =>
        new Response('SECRET upstream details', {
          status,
          headers: { 'Retry-After': '120' },
        }),
    );
    await assert.rejects(
      () => provider.quotes([asset], NOW),
      (error: unknown) =>
        error instanceof ProviderFailure &&
        error.reason === reason &&
        !error.message.includes('SECRET'),
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
      provider: 'COINGECKO',
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
  const provider = createCoinGeckoProvider('key', async () => {
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
  assert.equal(quote.provider, 'COINGECKO');
  const windows = budgetWindows(real(), timer.now(), 'quotes');
  assert.equal(
    (await fixture.store.usage('COINGECKO', windows)).find(
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
    const provider = createCoinGeckoProvider('key', async () => {
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
    assert.equal(fixture.states.get('COINGECKO')?.disabled, code === 401);
  }
});

test('exhausted windows roll back reservations; missing/expired billing configuration prevents real fetches', async () => {
  const fixture = memoryStore();
  const timer = clock();
  let calls = 0;
  const settings = real({ CG_MONTHLY_ATTEMPT_LIMIT: '1' });
  const windows = budgetWindows(settings, NOW, 'quotes');
  await fixture.store.reserve('COINGECKO', windows);
  await fixture.store.settle('COINGECKO', windows);
  const provider = createCoinGeckoProvider('key', async () => {
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
    (await fixture.store.usage('COINGECKO', windows)).every(
      (row) => row.used === 1,
    ),
  );
  assert.throws(() => budgetWindows(demo, NOW, 'quotes'), /not_configured/);
  assert.throws(
    () => budgetWindows(settings, Date.parse('2026-12-02T00:00:00Z'), 'quotes'),
    /billing_window_inactive/,
  );
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
  const provider = createCoinGeckoProvider('key', async () => {
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
  const provider = createCoinGeckoProvider(
    'synthetic-secret',
    async (input, options) => {
      calls++;
      const url = new URL(String(input));
      assert.equal(url.origin, 'https://api.coingecko.com');
      assert.ok(!url.toString().includes('synthetic-secret'));
      assert.equal(
        (options?.headers as Record<string, string>)['x-cg-demo-api-key'],
        'synthetic-secret',
      );
      if (url.pathname.endsWith('/coins/markets')) {
        const ids = url.searchParams.get('ids')!.split(',');
        assert.equal(ids.length, 10);
        return Response.json(
          ids.map((id) => ({
            id,
            current_price: 123.45,
            price_change_percentage_24h: 1.5,
            last_updated: new Date(NOW - 60_000).toISOString(),
          })),
        );
      }
      assert.ok(url.pathname.endsWith('/bitcoin/market_chart'));
      assert.equal(url.searchParams.get('days'), '1');
      assert.equal(url.searchParams.has('interval'), false);
      return Response.json({
        prices: [
          [NOW - 300_000, 122],
          [NOW, 123.45],
        ],
      });
    },
  );
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
          quote.provider === 'COINGECKO' &&
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
  assert.equal(chart.body.provider, 'COINGECKO');
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
    status.providers.find((row) => row.provider === 'COINGECKO')?.quoteReason,
    null,
  );
  assert.ok(!JSON.stringify(status).includes('synthetic-secret'));
});

test('unconfigured live crypto makes no upstream requests and stays unavailable while stocks are simulated', async () => {
  const fixture = memoryStore();
  const timer = clock();
  let calls = 0;
  const settings = marketSettingsSchema.parse({
    CRYPTO_DATA_MODE: 'coingecko',
  });
  const provider = createCoinGeckoProvider('', async () => {
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
          quote.status === 'unavailable' &&
          quote.provider === 'COINGECKO' &&
          !quote.simulated &&
          quote.reason === 'not_configured',
      ),
  );
  assert.ok(
    quotes
      .slice(10)
      .every((quote) => quote.status === 'fresh' && quote.simulated),
  );
  const providerStatus = (await service.status()).providers.find(
    (row) => row.provider === 'COINGECKO',
  )!;
  assert.equal(providerStatus.quoteReason, 'not_configured');
  assert.equal(providerStatus.historyReason, 'not_configured');
});

test('chart-only quota exhaustion does not label quote updates blocked; global exhaustion blocks both', async () => {
  const fixture = memoryStore();
  const settings = real({
    CG_CHART_DAILY_LIMIT: '1',
    CG_MONTHLY_ATTEMPT_LIMIT: '2',
  });
  const charts = budgetWindows(settings, NOW, 'history');
  await fixture.store.reserve('COINGECKO', charts);
  await fixture.store.settle('COINGECKO', charts);
  const service = createMarketService(
    fixture.store,
    settings,
    () => {},
    () => NOW,
  );
  let status = (await service.status()).providers.find(
    (row) => row.provider === 'COINGECKO',
  )!;
  assert.equal(status.quoteReason, null);
  assert.equal(status.historyReason, 'quota_exhausted');
  const quotes = budgetWindows(settings, NOW, 'quotes');
  await fixture.store.reserve('COINGECKO', quotes);
  await fixture.store.settle('COINGECKO', quotes);
  status = (await service.status()).providers.find(
    (row) => row.provider === 'COINGECKO',
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
    '1D': 30 * 60_000,
    '7D': 6 * 3600_000,
    '1M': 6 * 3600_000,
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
      provider: 'COINGECKO' as const,
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
    provider: 'COINGECKO' as const,
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
  const provider = createCoinGeckoProvider(
    'synthetic-secret',
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
  assert.equal(result.body.provider, 'COINGECKO');
  assert.equal(result.body.reason, 'unauthorized');
  assert.deepEqual(
    result.body.points.map((point) => point.price),
    ['123'],
  );
  const status = (await service.status()).providers.find(
    (row) => row.provider === 'COINGECKO',
  )!;
  assert.equal(status.quoteReason, 'unauthorized');
  assert.equal(status.historyReason, 'unauthorized');
  assert.ok(!JSON.stringify(status).includes('synthetic-secret'));
});

test('CoinGecko cannot ingest stocks or bypass approved application limits', async () => {
  let calls = 0;
  const provider = createCoinGeckoProvider('synthetic-secret', async () => {
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
    { CG_MONTHLY_ATTEMPT_LIMIT: 8001 },
    { CG_DAILY_ATTEMPT_LIMIT: 261 },
    { CG_MINUTE_ATTEMPT_LIMIT: 11 },
    { CG_CHART_DAILY_LIMIT: 81 },
    { STOCK_DATA_MODE: 'coingecko' },
  ])
    assert.equal(marketSettingsSchema.safeParse(config).success, false);
});
