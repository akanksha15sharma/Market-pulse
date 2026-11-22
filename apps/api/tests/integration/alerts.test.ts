import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createDatabaseClient } from '../../src/db/client.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { createAlertService } from '../../src/modules/alerts/service.js';
import { createMarketRepository } from '../../src/modules/markets/repository.js';
import type { CachedQuote } from '../../src/modules/markets/types.js';
import { HttpError } from '../../src/lib/http-error.js';
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Explicit local TEST_DATABASE_URL is required');
const target = new URL(url);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  target.pathname !== '/marketpulse_test'
)
  throw new Error('Alert tests require local marketpulse_test');
const db = createDatabaseClient(url);
const otherDb = createDatabaseClient(url);
const service = createAlertService(db);
const secondService = createAlertService(otherDb);
const store = createMarketRepository(db);
const secondStore = createMarketRepository(otherDb);
const users: string[] = [];
const assets: string[] = [];
before(async () => {
  await db.$connect();
  await otherDb.$connect();
});
after(async () => {
  try {
    if (users.length)
      await db.user.deleteMany({ where: { id: { in: users } } });
    if (assets.length) {
      await db.historicalBar.deleteMany({ where: { assetId: { in: assets } } });
      await db.historyCache.deleteMany({ where: { assetId: { in: assets } } });
      await db.latestQuote.deleteMany({ where: { assetId: { in: assets } } });
      await db.asset.deleteMany({ where: { id: { in: assets } } });
    }
  } finally {
    await Promise.all([db.$disconnect(), otherDb.$disconnect()]);
  }
});
const status = (code: number) => (error: unknown) =>
  error instanceof HttpError && error.status === code;
async function fixture(stock = false) {
  const user = await db.user.create({
    data: {
      email: `${randomUUID()}@example.test`,
      displayName: 'Synthetic alert test',
      passwordHash: 'unused-test-hash',
    },
  });
  users.push(user.id);
  const asset = await db.asset.create({
    data: {
      key: `alert-test:${randomUUID()}`,
      symbol: 'ALERTTEST',
      name: 'Synthetic alert asset',
      type: stock ? 'STOCK' : 'CRYPTO',
      isDemoOnly: stock,
      exchange: stock ? 'NASDAQ' : null,
    },
  });
  assets.push(asset.id);
  return { userId: user.id, assetId: asset.id };
}
function observation(
  assetId: string,
  price = '100',
  offset = 1000,
): CachedQuote {
  const now = Date.now();
  return {
    assetId,
    provider: 'COINPAPRIKA',
    mode: 'REAL',
    price,
    changePercent: null,
    sourceAt: now - offset,
    fetchedAt: now,
  };
}
async function armForTest(
  userId: string,
  assetId: string,
  direction: 'ABOVE' | 'BELOW' = 'ABOVE',
  threshold = '100',
) {
  const alert = await service.create(userId, { assetId, direction, threshold });
  await db.priceAlert.update({
    where: { id: alert.id },
    data: { armedAt: new Date(Date.now() - 60_000) },
  });
  return alert;
}

test('alert CRUD and history are persisted, owner-scoped, and duplicate active targets are rejected', async () => {
  const { userId, assetId } = await fixture();
  const stranger = (await fixture()).userId;
  const alert = await armForTest(userId, assetId);
  assert.equal(
    (await secondService.get(userId, alert.id)).threshold,
    '100.000000000000000000',
  );
  await assert.rejects(
    () =>
      service.create(userId, {
        assetId,
        direction: 'ABOVE',
        threshold: '100.0',
      }),
    status(409),
  );
  for (const operation of [
    () => service.get(stranger, alert.id),
    () =>
      service.edit(stranger, alert.id, { direction: 'BELOW', threshold: '99' }),
    () => service.pause(stranger, alert.id),
    () => service.rearm(stranger, alert.id),
    () => service.events(stranger, alert.id, { page: 1, limit: 20 }),
    () => service.delete(stranger, alert.id),
  ])
    await assert.rejects(operation, status(404));
  assert.equal((await service.list(stranger, { page: 1, limit: 20 })).total, 0);
  assert.equal(
    (
      await service.edit(userId, alert.id, {
        direction: 'BELOW',
        threshold: '99',
      })
    ).status,
    'PAUSED',
  );
  assert.equal((await service.rearm(userId, alert.id)).activation, 2);
  await service.delete(userId, alert.id);
  await assert.rejects(() => service.get(userId, alert.id), status(404));
});

test('concurrent create/rearm across two pools cannot exceed ten active alerts', async () => {
  const { userId, assetId } = await fixture();
  for (let index = 1; index <= 9; index++)
    await service.create(userId, {
      assetId,
      direction: 'ABOVE',
      threshold: String(index),
    });
  const spare = await service.create(userId, {
    assetId,
    direction: 'ABOVE',
    threshold: '20',
  });
  await service.pause(userId, spare.id);
  const results = await Promise.allSettled([
    service.create(userId, { assetId, direction: 'ABOVE', threshold: '21' }),
    secondService.rearm(userId, spare.id),
  ]);
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  for (const result of results)
    if (result.status === 'rejected') assert.ok(status(409)(result.reason));
  assert.equal(
    (await service.list(userId, { page: 1, limit: 20 })).activeCount,
    10,
  );
});

test('accepted real quote and event commit once under concurrent duplicate ingestion; replay/older sources cannot retrigger', async () => {
  const { userId, assetId } = await fixture();
  const alert = await armForTest(userId, assetId);
  const quote = observation(assetId);
  await Promise.all([
    store.saveQuotes([quote]),
    secondStore.saveQuotes([quote]),
  ]);
  await createMarketRepository(db).saveQuotes([quote]);
  await store.saveQuotes([
    { ...quote, price: '101', sourceAt: quote.sourceAt - 1 },
  ]);
  const saved = await service.get(userId, alert.id);
  assert.equal(saved.status, 'TRIGGERED');
  const events = await service.events(userId, alert.id, { page: 1, limit: 20 });
  assert.equal(events.total, 1);
  assert.equal(events.events[0]!.verifiedReal, true);
  assert.equal(events.events[0]!.observedPrice, '100.000000000000000000');
  assert.equal(events.events[0]!.provider, 'COINPAPRIKA');
  assert.equal(await db.notification.count({ where: { userId } }), 0);
});

test('demo, stale, future, pre-arm, inactive and historical data do not trigger alerts', async () => {
  for (const kind of [
    'demo',
    'stale',
    'future',
    'prearm',
    'inactive',
    'paused',
    'history',
  ] as const) {
    const { userId, assetId } = await fixture();
    const alert = await armForTest(userId, assetId);
    let quote = observation(assetId);
    if (kind === 'demo') quote = { ...quote, provider: 'DEMO', mode: 'DEMO' };
    if (kind === 'stale')
      quote = { ...quote, sourceAt: Date.now() - 21 * 60_000 };
    if (kind === 'future') quote = { ...quote, sourceAt: Date.now() + 60_000 };
    if (kind === 'prearm')
      await db.priceAlert.update({
        where: { id: alert.id },
        data: { armedAt: new Date(Date.now()) },
      });
    if (kind === 'paused') await service.pause(userId, alert.id);
    if (kind === 'inactive')
      await db.asset.update({
        where: { id: assetId },
        data: { isActive: false },
      });
    if (kind === 'history') {
      const key = {
        assetId,
        provider: 'COINPAPRIKA' as const,
        mode: 'REAL' as const,
        range: '1D' as const,
      };
      await store.enqueue(key, Date.now());
      await store.saveHistory(
        key,
        [{ timestamp: Date.now(), price: '100' }],
        Date.now(),
        1800_000,
      );
    } else await store.saveQuotes([quote]);
    assert.equal(
      (await service.get(userId, alert.id)).status,
      kind === 'paused' ? 'PAUSED' : 'ACTIVE',
      kind,
    );
    assert.equal(
      (await service.events(userId, alert.id, { page: 1, limit: 20 })).total,
      0,
      kind,
    );
  }
  const stock = await fixture(true);
  const saved = await service.create(stock.userId, {
    assetId: stock.assetId,
    direction: 'ABOVE',
    threshold: '1',
  });
  assert.equal(saved.eligibility, 'real_data_required');
  await store.saveQuotes([
    { ...observation(stock.assetId, '100'), provider: 'DEMO', mode: 'DEMO' },
  ]);
  assert.equal(
    (await service.events(stock.userId, saved.id, { page: 1, limit: 20 }))
      .total,
    0,
  );
});

test('pause/edit/rearm preserve event target snapshots and require a new post-arm observation', async () => {
  const { userId, assetId } = await fixture();
  const alert = await armForTest(userId, assetId);
  const first = observation(assetId);
  await store.saveQuotes([first]);
  const edited = await service.edit(userId, alert.id, {
    direction: 'BELOW',
    threshold: '110',
  });
  assert.equal(edited.status, 'PAUSED');
  let events = await service.events(userId, alert.id, { page: 1, limit: 20 });
  assert.equal(events.events[0]?.targetPrice, '100.000000000000000000');
  assert.equal(events.events[0]?.direction, 'ABOVE');
  const rearmed = await service.rearm(userId, alert.id);
  assert.equal(rearmed.activation, 2);
  assert.equal((await secondService.rearm(userId, alert.id)).activation, 2);
  await store.saveQuotes([first]);
  assert.equal((await service.get(userId, alert.id)).status, 'ACTIVE');
  await delay(10);
  const now = Date.now();
  await store.saveQuotes([
    { ...observation(assetId, '100', 0), sourceAt: now - 1, fetchedAt: now },
  ]);
  events = await service.events(userId, alert.id, { page: 1, limit: 20 });
  assert.equal(events.total, 2);
  assert.equal(events.events[0]?.targetPrice, '110.000000000000000000');
  assert.equal(events.events[0]?.direction, 'BELOW');
  await service.delete(userId, alert.id);
  assert.equal(await db.alertEvent.count({ where: { alertId: alert.id } }), 0);
  assert.ok(await db.asset.findUnique({ where: { id: assetId } }));
});

test('failed quote/alert transaction rolls back cached price, event and triggered status together', async () => {
  const { userId, assetId } = await fixture();
  const alert = await armForTest(userId, assetId);
  const failure = new Error('synthetic transaction failure');
  const proxy = new Proxy(db, {
    get(target, property, receiver) {
      if (property === '$transaction')
        return async (
          operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
        ) =>
          target.$transaction(async (tx) => {
            await operation(tx);
            assert.equal(
              await tx.alertEvent.count({ where: { alertId: alert.id } }),
              1,
            );
            assert.equal(
              (
                await tx.priceAlert.findUniqueOrThrow({
                  where: { id: alert.id },
                })
              ).status,
              'TRIGGERED',
            );
            throw failure;
          });
      return Reflect.get(target, property, receiver);
    },
  });
  await assert.rejects(
    () => createMarketRepository(proxy).saveQuotes([observation(assetId)]),
    (error: unknown) => error === failure,
  );
  assert.equal(await db.latestQuote.count({ where: { assetId } }), 0);
  assert.equal((await service.get(userId, alert.id)).status, 'ACTIVE');
  assert.equal(
    (await service.events(userId, alert.id, { page: 1, limit: 20 })).total,
    0,
  );
});

test('database audit constraint rejects simulated and non-reaching event snapshots', async () => {
  const { userId, assetId } = await fixture();
  const alert = await armForTest(userId, assetId);
  const now = new Date();
  for (const data of [
    { provider: 'DEMO' as const, mode: 'DEMO' as const, observedPrice: '100' },
    {
      provider: 'COINPAPRIKA' as const,
      mode: 'REAL' as const,
      observedPrice: '99',
    },
  ])
    await assert.rejects(() =>
      db.alertEvent.create({
        data: {
          alertId: alert.id,
          activation: 1,
          sourceAt: now,
          fetchedAt: now,
          triggeredAt: now,
          targetPrice: '100',
          direction: 'ABOVE',
          ...data,
        },
      }),
    );
  assert.equal(
    (await service.events(userId, alert.id, { page: 1, limit: 20 })).total,
    0,
  );
});
