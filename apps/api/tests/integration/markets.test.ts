import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { createDatabaseClient } from '../../src/db/client.js';
import { createMarketRepository } from '../../src/modules/markets/repository.js';
import {
  MarketDeferred,
  type BudgetWindow,
} from '../../src/modules/markets/types.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Explicit local TEST_DATABASE_URL is required');
const target = new URL(url);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  target.pathname !== '/marketpulse_test'
)
  throw new Error('Market DB tests require local marketpulse_test');
const db = createDatabaseClient(url);
const store = createMarketRepository(db);
const ids: string[] = [];
const keys: string[] = [];
const categories: string[] = [];
const now = Date.now();
let connected = false;
before(async () => {
  await db.$connect();
  connected = true;
});
after(async () => {
  if (!connected) {
    await db.$disconnect();
    return;
  }
  try {
    await db.historicalBar.deleteMany({ where: { assetId: { in: ids } } });
    await db.historyCache.deleteMany({ where: { assetId: { in: ids } } });
    await db.latestQuote.deleteMany({ where: { assetId: { in: ids } } });
    await db.asset.deleteMany({ where: { id: { in: ids } } });
    await db.schedulerLease.deleteMany({ where: { key: { in: keys } } });
    await db.providerUsage.deleteMany({
      where: { category: { in: categories } },
    });
  } finally {
    await db.$disconnect();
  }
});
async function asset() {
  const result = await db.asset.create({
    data: {
      key: `test:${randomUUID()}`,
      type: 'CRYPTO',
      symbol: 'TEST',
      name: 'Synthetic DB fixture',
    },
  });
  ids.push(result.id);
  return result.id;
}

test('cached quotes survive repository recreation, preserve real/demo separation and ignore older sources', async () => {
  const assetId = await asset();
  const quote = {
    assetId,
    provider: 'COINPAPRIKA' as const,
    mode: 'REAL' as const,
    price: '123.123456789012345678',
    changePercent: null,
    sourceAt: now,
    fetchedAt: now,
  };
  await store.saveQuotes([quote]);
  await store.saveQuotes([
    { ...quote, price: '1', sourceAt: now - 1 },
    { ...quote, price: '999', provider: 'DEMO', mode: 'DEMO' },
  ]);
  const rows = (await createMarketRepository(db).quotes()).filter(
    (row) => row.assetId === assetId,
  );
  assert.equal(rows.length, 2);
  assert.equal(
    rows.find((row) => row.provider === 'COINPAPRIKA')?.price,
    quote.price,
  );
});

test('legacy CoinGecko caches remain untouched and are excluded from active free-provider reads', async () => {
  const assetId = await asset();
  await db.latestQuote.create({
    data: {
      assetId,
      provider: 'COINGECKO',
      mode: 'REAL',
      currency: 'USD',
      price: '999',
      sourceAt: new Date(now),
      fetchedAt: new Date(now),
    },
  });
  await store.saveQuotes([
    {
      assetId,
      provider: 'COINPAPRIKA',
      mode: 'REAL',
      price: '123',
      changePercent: null,
      sourceAt: now,
      fetchedAt: now,
    },
  ]);
  const active = (await store.quotes()).filter(
    (row) => row.assetId === assetId,
  );
  assert.equal(active.length, 1);
  assert.equal(active[0]?.provider, 'COINPAPRIKA');
  assert.equal(active[0]?.price, '123.000000000000000000');
  assert.equal(
    await db.latestQuote.count({ where: { assetId, provider: 'COINGECKO' } }),
    1,
  );
});

test('concurrent quota reservations respect limits and roll back all windows atomically', async () => {
  const prefix = randomUUID();
  const windows: BudgetWindow[] = [
    { category: `${prefix}:a`, start: now, end: now + 60_000, limit: 10 },
    { category: `${prefix}:z`, start: now, end: now + 60_000, limit: 2 },
  ];
  categories.push(...windows.map((window) => window.category));
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () => store.reserve('COINPAPRIKA', windows)),
  );
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    2,
  );
  for (const result of results)
    if (result.status === 'rejected')
      assert.ok(result.reason instanceof MarketDeferred);
  const usage = await createMarketRepository(db).usage('COINPAPRIKA', windows);
  assert.ok(usage.every((row) => row.used === 2));
  await store.settle('COINPAPRIKA', windows);
  assert.ok(
    (await store.usage('COINPAPRIKA', windows)).every((row) => row.used === 2),
  );
});

test('scheduler leases have one owner, enforce expiry and reject release by another owner', async () => {
  const key = `test:${randomUUID()}`;
  keys.push(key);
  const owners = Array.from({ length: 6 }, () => randomUUID());
  const acquired = await Promise.all(
    owners.map((owner) => store.acquire(key, owner, now, now + 60_000)),
  );
  assert.equal(acquired.filter(Boolean).length, 1);
  const owner = owners[acquired.findIndex(Boolean)]!;
  await store.release(key, 'unrelated-owner');
  assert.equal(await store.acquire(key, 'new', now, now + 60_000), false);
  await store.release(key, owner);
  assert.equal(await store.acquire(key, 'new', now, now + 60_000), true);
  assert.equal(
    await store.acquire(key, 'after-expiry', now + 60_001, now + 120_000),
    true,
  );
});

test('history requests coalesce durably and cached ranges remain independent', async () => {
  const assetId = await asset();
  const key = {
    assetId,
    provider: 'DEMO' as const,
    mode: 'DEMO' as const,
    range: '1D' as const,
  };
  await Promise.all(Array.from({ length: 10 }, () => store.enqueue(key, now)));
  assert.equal(await db.historyCache.count({ where: { assetId } }), 1);
  await store.saveHistory(
    key,
    [{ timestamp: now - 300_000, price: '1.123456789012345678' }],
    now,
    1800_000,
  );
  await store.enqueue(key, now);
  assert.equal((await store.history(key, now))?.pending, false);
  const weekly = { ...key, range: '7D' as const };
  await store.enqueue(weekly, now);
  await store.saveHistory(
    weekly,
    [{ timestamp: now - 3600_000, price: '2' }],
    now,
    6 * 3600_000,
  );
  const cached = await createMarketRepository(db).history(key, now);
  assert.equal(cached?.pending, false);
  assert.equal(cached?.points[0]?.price, '1.123456789012345678');
  assert.equal(cached?.freshUntil, now + 1800_000);
  assert.deepEqual((await store.history(key, now + 49 * 3600_000))?.points, []);
});
