import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createDatabaseClient } from '../../src/db/client.js';
import { createWatchlistService } from '../../src/modules/watchlists/service.js';
import { createAuthService } from '../../src/modules/auth/service.js';
import { createApp } from '../../src/app.js';
import { digest, newToken } from '../../src/modules/auth/security.js';
import { HttpError } from '../../src/lib/http-error.js';
import { cookieJar, request } from '../helpers/http.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Explicit local TEST_DATABASE_URL is required');
const target = new URL(url);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  target.pathname !== '/marketpulse_test'
)
  throw new Error('Watchlist DB tests require local marketpulse_test');
const db = createDatabaseClient(url);
const otherDb = createDatabaseClient(url);
const service = createWatchlistService(db);
const secondService = createWatchlistService(otherDb);
const users: string[] = [];
const assets: string[] = [];
const keys: string[] = [];
const status = (expected: number) => (error: unknown) =>
  error instanceof HttpError && error.status === expected;
before(async () => {
  await db.$connect();
  await otherDb.$connect();
});
after(async () => {
  try {
    if (users.length)
      await db.user.deleteMany({ where: { id: { in: users } } });
    if (assets.length)
      await db.asset.deleteMany({ where: { id: { in: assets } } });
    if (keys.length)
      await db.authRateLimit.deleteMany({ where: { key: { in: keys } } });
  } finally {
    await Promise.all([db.$disconnect(), otherDb.$disconnect()]);
  }
});
async function user() {
  const row = await db.user.create({
    data: {
      email: `${randomUUID()}@example.test`,
      displayName: 'Synthetic watchlist test',
      passwordHash: 'test-only-unused-hash',
    },
  });
  users.push(row.id);
  return row.id;
}
async function catalog(count = 2) {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    key: `watchlist-test:${randomUUID()}`,
    symbol: `TEST${index}`,
    name: `Synthetic asset ${index}`,
    type: index % 2 ? ('STOCK' as const) : ('CRYPTO' as const),
    isDemoOnly: index % 2 === 1,
    exchange: index % 2 ? 'NASDAQ' : null,
  }));
  await db.asset.createMany({ data: rows });
  assets.push(...rows.map((row) => row.id));
  return rows;
}

test('PostgreSQL persists named lists, crypto and stocks, and rejects every cross-account operation', async () => {
  const owner = await user();
  const stranger = await user();
  const [crypto, stock] = await catalog();
  assert.ok(crypto && stock);
  const list = await service.create(owner, { name: '  Core ideas  ' });
  await service.rename(owner, list.id, { name: 'Long-term' });
  await service.add(owner, list.id, crypto.id);
  await service.add(owner, list.id, stock.id);
  const saved = await secondService.get(owner, list.id);
  assert.equal(saved.name, 'Long-term');
  assert.equal(saved.items.length, 2);
  assert.deepEqual(
    new Set(saved.items.map((item) => item.asset.type)),
    new Set(['CRYPTO', 'STOCK']),
  );
  assert.ok(!JSON.stringify(saved).includes('userId'));
  assert.deepEqual(await service.list(stranger), []);
  for (const operation of [
    () => service.get(stranger, list.id),
    () => service.rename(stranger, list.id, { name: 'Stolen' }),
    () => service.delete(stranger, list.id),
    () => service.add(stranger, list.id, crypto.id),
    () => service.remove(stranger, list.id, stock.id),
  ])
    await assert.rejects(operation, status(404));
  assert.equal((await service.get(owner, list.id)).items.length, 2);
});

test('concurrent list creation across two pools cannot exceed five lists per account', async () => {
  const owner = await user();
  const results = await Promise.allSettled(
    Array.from({ length: 7 }, (_, index) =>
      (index % 2 ? service : secondService).create(owner, {
        name: `List ${index}`,
      }),
    ),
  );
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    5,
  );
  for (const result of results)
    if (result.status === 'rejected') assert.ok(status(409)(result.reason));
  const lists = await service.list(owner);
  assert.equal(lists.length, 5);
  await service.delete(owner, lists[0]!.id);
  await service.create(owner, { name: 'New slot' });
  assert.equal((await secondService.list(owner)).length, 5);
});

test('concurrent additions enforce twenty items and duplicates remain idempotent at capacity', async () => {
  const owner = await user();
  const rows = await catalog(21);
  const list = await service.create(owner, { name: 'At capacity' });
  for (const asset of rows.slice(0, 19))
    await service.add(owner, list.id, asset.id);
  const results = await Promise.allSettled([
    service.add(owner, list.id, rows[19]!.id),
    secondService.add(owner, list.id, rows[20]!.id),
  ]);
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(
    rejected && rejected.status === 'rejected' && status(409)(rejected.reason),
  );
  await Promise.all([
    service.add(owner, list.id, rows[0]!.id),
    secondService.add(owner, list.id, rows[0]!.id),
  ]);
  const saved = await service.get(owner, list.id);
  assert.equal(saved.items.length, 20);
  await service.remove(owner, list.id, rows[0]!.id);
  await service.remove(owner, list.id, rows[0]!.id);
  const missing = rows.find(
    (row) => !saved.items.some((item) => item.asset.id === row.id),
  );
  assert.ok(missing);
  await service.add(owner, list.id, missing.id);
  assert.equal((await service.get(owner, list.id)).items.length, 20);
});

test('unknown/inactive assets are rejected, saved inactive assets remain visible and removable', async () => {
  const owner = await user();
  const [asset] = await catalog(1);
  assert.ok(asset);
  const list = await service.create(owner, { name: 'Retained membership' });
  await assert.rejects(
    () => service.add(owner, list.id, randomUUID()),
    status(404),
  );
  await service.add(owner, list.id, asset.id);
  await db.asset.update({ where: { id: asset.id }, data: { isActive: false } });
  await assert.rejects(
    () => service.add(owner, list.id, asset.id),
    status(404),
  );
  assert.equal(
    (await secondService.get(owner, list.id)).items[0]!.available,
    false,
  );
  await service.remove(owner, list.id, asset.id);
  assert.equal((await service.get(owner, list.id)).items.length, 0);
});

test('deleting a list cascades its memberships without deleting shared assets or other lists', async () => {
  const owner = await user();
  const [asset] = await catalog(1);
  assert.ok(asset);
  const first = await service.create(owner, { name: 'First' });
  const second = await service.create(owner, { name: 'Second' });
  await service.add(owner, first.id, asset.id);
  await service.add(owner, second.id, asset.id);
  await service.delete(owner, first.id);
  assert.equal(
    await db.watchlistItem.count({ where: { watchlistId: first.id } }),
    0,
  );
  assert.equal((await service.get(owner, second.id)).items.length, 1);
  assert.ok(await db.asset.findUnique({ where: { id: asset.id } }));
});

test('real PostgreSQL sessions protect the HTTP persistence flow and expired/revoked sessions stop writes', async () => {
  const owner = await user();
  const token = newToken();
  const session = await db.session.create({
    data: {
      userId: owner,
      tokenHash: digest(token),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const config = {
    origin: 'http://localhost:5173',
    secret: 'a'.repeat(64),
    secure: false,
    ttlSeconds: 3600,
  };
  const auth = createAuthService(db, config, {
    enabled: false,
    async send() {},
  });
  const app = createApp(auth, config, undefined, service);
  keys.push(
    digest(`watchlists:write:${owner}`),
    digest(`watchlists:read:${owner}`),
  );
  const cookie = `mp_session=${token}`;
  const csrf = await request(app, 'GET', '/api/v1/auth/csrf', { cookie });
  const jar = cookieJar();
  jar.update(csrf.headers);
  const headers = {
    cookie: `${cookie}; ${jar.header()}`,
    origin: config.origin,
    'x-csrf-token': csrf.body.csrfToken as string,
  };
  const result = await request(app, 'POST', '/api/v1/watchlists', headers, {
    name: 'Session saved',
  });
  assert.equal(result.status, 201);
  assert.equal((await secondService.list(owner)).length, 1);
  await db.session.update({
    where: { id: session.id },
    data: { expiresAt: new Date(0) },
  });
  assert.equal(
    (
      await request(app, 'POST', '/api/v1/watchlists', headers, {
        name: 'Expired',
      })
    ).status,
    401,
  );
  await db.session.update({
    where: { id: session.id },
    data: { expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date() },
  });
  assert.equal(
    (await request(app, 'GET', '/api/v1/watchlists', headers)).status,
    401,
  );
  assert.equal((await secondService.list(owner)).length, 1);
});
