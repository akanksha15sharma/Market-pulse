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
