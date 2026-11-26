import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import {
  legacyNotificationMessage,
  notificationEventKey,
} from '@marketpulse/contracts';
import { createDatabaseClient } from '../../src/db/client.js';
import { createNotificationService } from '../../src/modules/notifications/service.js';
import { notificationTransaction } from '../../src/modules/notifications/transaction.js';
import { createAuthService } from '../../src/modules/auth/service.js';
import { digest, newToken } from '../../src/modules/auth/security.js';
import { createApp } from '../../src/app.js';
import { HttpError } from '../../src/lib/http-error.js';
import { cookieJar, request } from '../helpers/http.js';

const raw = process.env.TEST_DATABASE_URL;
if (!raw) throw new Error('Explicit local TEST_DATABASE_URL required');
const target = new URL(raw);
if (
  !['postgres:', 'postgresql:'].includes(target.protocol) ||
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  target.pathname !== '/marketpulse_test' ||
  target.search ||
  target.hash
)
  throw new Error(
    'Notification API tests require local marketpulse_test without overrides',
  );
const db = createDatabaseClient(raw);
const otherDb = createDatabaseClient(raw);
const secret = 'a'.repeat(64);
const service = createNotificationService(db, secret);
const second = createNotificationService(otherDb, secret);
const users: string[] = [];
const keys: string[] = [];
const status = (expected: number) => (error: unknown) =>
  error instanceof HttpError && error.status === expected;
before(async () => {
  await db.$connect();
  await otherDb.$connect();
});
after(async () => {
  try {
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.authRateLimit.deleteMany({ where: { key: { in: keys } } });
  } finally {
    await Promise.all([db.$disconnect(), otherDb.$disconnect()]);
  }
});
async function user() {
  const row = await db.user.create({
    data: {
      email: `${randomUUID()}@e2.test`,
      displayName: 'Isolated E2 test',
      passwordHash: 'unused-test-only-hash',
    },
  });
  users.push(row.id);
  return row.id;
}
async function notification(
  userId: string,
  options: {
    at?: Date;
    readAt?: Date;
    legacy?: boolean;
    watchlistId?: string;
  } = {},
) {
  return db.notification.create({
    data: {
      userId,
      message: options.legacy
        ? 'Unverified old price triggered at 9999'
        : 'A genuine fixture account action',
      ...(options.at ? { createdAt: options.at } : {}),
      readAt: options.readAt ?? null,
      ...(options.legacy
        ? {}
        : {
            kind: options.watchlistId ? 'WATCHLIST_CREATED' : 'SIGNED_IN',
            eventKey: notificationEventKey(
              options.watchlistId ? 'WATCHLIST_CREATED' : 'SIGNED_IN',
              randomUUID(),
            ),
            subjectType: options.watchlistId ? 'WATCHLIST' : 'ACCOUNT',
            subjectId: options.watchlistId ?? userId,
          }),
    },
  });
}

test('history, counts and read controls are owner-scoped; legacy text and private metadata never escape', async () => {
  const owner = await user(),
    stranger = await user();
  const row = await notification(owner);
  const old = await notification(owner, { legacy: true });
  await notification(stranger);
  const history = await service.history(owner, {});
  assert.equal(history.notifications.length, 2);
  assert.equal(history.unreadCount, 2);
  const legacy = history.notifications.find((item) => item.id === old.id)!;
  assert.equal(legacy.message, legacyNotificationMessage);
  assert.equal(legacy.actionUrl, null);
  assert.equal(legacy.subjectId, null);
  assert.equal(
    history.notifications.find((item) => item.id === row.id)!.actionUrl,
    '/account',
  );
  const json = JSON.stringify(history);
  for (const privateField of [
    'userId',
    'eventKey',
    'alertEventId',
    '9999',
    'passwordHash',
  ])
    assert.ok(!json.includes(privateField));
  for (const id of [row.id, randomUUID()])
    await assert.rejects(
      () => service.setRead(stranger, id, true),
      status(404),
    );
  assert.equal((await service.summary(owner)).unreadCount, 2);
  assert.equal((await service.summary(stranger)).unreadCount, 1);
  assert.equal(
    (await db.notification.findUniqueOrThrow({ where: { id: old.id } }))
      .message,
    'Unverified old price triggered at 9999',
  );
});

test('keyset pagination orders timestamp ties, avoids duplicates after insertion/deletion and rejects cross-account/filter cursors', async () => {
  const owner = await user(),
    stranger = await user();
  const at = new Date('2026-01-01T00:00:00.000Z');
  const rows = await Promise.all(
    Array.from({ length: 6 }, () => notification(owner, { at })),
  );
  const sorted = rows
    .map((row) => row.id)
    .sort()
    .reverse();
  const page1 = await service.history(owner, { limit: 2 });
  assert.deepEqual(
    page1.notifications.map((row) => row.id),
    sorted.slice(0, 2),
  );
  assert.ok(page1.nextCursor);
  await notification(owner, { at: new Date('2026-01-02T00:00:00.000Z') });
  // Deleting the cursor's row does not break keyset pagination: it stores values, not an FK.
  await db.notification.delete({ where: { id: sorted[1]! } });
  const page2 = await second.history(owner, {
    limit: 2,
    cursor: page1.nextCursor,
  });
  const page3 = await second.history(owner, {
    limit: 2,
    cursor: page2.nextCursor,
  });
  assert.deepEqual(
    [...page2.notifications, ...page3.notifications].map((row) => row.id),
    sorted.slice(2),
  );
  assert.equal(page3.nextCursor, null);
  await assert.rejects(
    () => service.history(stranger, { cursor: page1.nextCursor }),
    status(400),
  );
  await assert.rejects(
    () =>
      service.history(owner, { cursor: page1.nextCursor, filter: 'unread' }),
    status(400),
  );
  await assert.rejects(
    () => service.history(owner, { cursor: 'tampered' }),
    status(400),
  );
});

test('read/unread and mark-all are idempotent across two connections and preserve first read timestamps', async () => {
  const owner = await user(),
    stranger = await user();
  const row = await notification(owner);
  await notification(owner);
  const foreign = await notification(stranger);
  const results = await Promise.all([
    service.setRead(owner, row.id, true),
    second.setRead(owner, row.id, true),
  ]);
  assert.equal(
    results[0]!.notification.readAt,
    results[1]!.notification.readAt,
  );
  const firstReadAt = results[0]!.notification.readAt;
  assert.ok(firstReadAt);
  const all = await Promise.all([
    service.markAllRead(owner),
    second.markAllRead(owner),
  ]);
  assert.deepEqual(all.map((result) => result.updatedCount).sort(), [0, 1]);
  assert.equal(
    (await service.setRead(owner, row.id, true)).notification.readAt,
    firstReadAt,
  );
  await Promise.all([
    service.setRead(owner, row.id, false),
    second.setRead(owner, row.id, false),
  ]);
  assert.equal((await service.summary(owner)).unreadCount, 1);
  assert.equal(
    (await service.history(owner, { filter: 'read' })).notifications.length,
    1,
  );
  assert.equal(
    (await service.history(owner, { filter: 'unread' })).notifications[0]!.id,
    row.id,
  );
  assert.equal(
    (await db.notification.findUniqueOrThrow({ where: { id: foreign.id } }))
      .readAt,
    null,
  );
});

test('concurrent read-all/unread operations have a serial outcome without lost or cross-user writes', async () => {
  const owner = await user();
  const row = await notification(owner);
  await Promise.all([
    service.markAllRead(owner),
    second.setRead(owner, row.id, false),
  ]);
  const stored = await db.notification.findUniqueOrThrow({
    where: { id: row.id },
  });
  assert.equal(
    (await service.summary(owner)).unreadCount,
    stored.readAt ? 0 : 1,
  );
  // A later real operation must not inherit an earlier mark-all action.
  const later = await notification(owner);
  assert.equal(
    (await db.notification.findUniqueOrThrow({ where: { id: later.id } }))
      .readAt,
    null,
  );
});

test('preferences read lazily; concurrent partial writes preserve both flags and existing email preferences', async () => {
  const owner = await user(),
    stranger = await user();
  await db.user.update({
    where: { id: owner },
    data: { emailAlertsEnabled: true },
  });
  assert.deepEqual(await service.preferences(owner), {
    accountActivityEnabled: true,
    watchlistActivityEnabled: true,
    securityNotificationsRequired: true,
  });
  assert.equal(
    await db.notificationPreference.count({ where: { userId: owner } }),
    0,
  );
  await Promise.all([
    service.patchPreferences(owner, { accountActivityEnabled: false }),
    second.patchPreferences(owner, { watchlistActivityEnabled: false }),
  ]);
  assert.deepEqual(await second.preferences(owner), {
    accountActivityEnabled: false,
    watchlistActivityEnabled: false,
    securityNotificationsRequired: true,
  });
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: owner } }))
      .emailAlertsEnabled,
    true,
  );
  assert.equal(
    (await service.preferences(stranger)).accountActivityEnabled,
    true,
  );
  const before = await db.notificationPreference.findUniqueOrThrow({
    where: { userId: owner },
  });
  await service.patchPreferences(owner, { accountActivityEnabled: false });
  const after = await db.notificationPreference.findUniqueOrThrow({
    where: { userId: owner },
  });
  assert.equal(after.accountActivityEnabled, before.accountActivityEnabled);
  await assert.rejects(() =>
    service.patchPreferences(owner, { securityNotificationsRequired: false }),
  );
});

test('links target only owned, surviving watchlists; deleted or foreign snapshots use the safe list page', async () => {
  const owner = await user(),
    stranger = await user();
  const own = await db.watchlist.create({
    data: { userId: owner, name: 'Private list' },
  });
  const foreign = await db.watchlist.create({
    data: { userId: stranger, name: 'Secret other list' },
  });
  const row = await notification(owner, { watchlistId: own.id });
  const unsafe = await notification(owner, { watchlistId: foreign.id });
  const page = await service.history(owner, {});
  assert.equal(
    page.notifications.find((item) => item.id === row.id)!.actionUrl,
    `/watchlists?list=${own.id}`,
  );
  assert.equal(
    page.notifications.find((item) => item.id === unsafe.id)!.actionUrl,
    '/watchlists',
  );
  assert.ok(!JSON.stringify(page).includes('Secret other list'));
  await db.watchlist.delete({ where: { id: own.id } });
  assert.equal(
    (await service.setRead(owner, row.id, true)).notification.actionUrl,
    '/watchlists',
  );
});

test('transaction helper rolls back changes atomically and rejects deleted accounts', async () => {
  const owner = await user();
  await assert.rejects(
    () =>
      notificationTransaction(db, owner, async (tx) => {
        await tx.notificationPreference.create({
          data: { userId: owner, accountActivityEnabled: false },
        });
        throw new Error('Test rollback');
      }),
    /Test rollback/,
  );
  assert.equal(
    await db.notificationPreference.count({ where: { userId: owner } }),
    0,
  );
  await assert.rejects(
    () => notificationTransaction(db, randomUUID(), async () => true),
    status(401),
  );
});

test('real session HTTP flow enforces ownership, CSRF, validation, shared rate limits and revoked/expired sessions', async () => {
  const owner = await user(),
    stranger = await user();
  const row = await notification(owner);
  const foreign = await notification(stranger);
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
    secret,
    secure: false,
    ttlSeconds: 3600,
  };
  const auth = createAuthService(db, config, {
    enabled: false,
    async send() {},
  });
  const app = createApp(auth, config, undefined, undefined, undefined, {
    notifications: service,
  });
  const cookie = `mp_session=${token}`;
  const csrf = await request(app, 'GET', '/api/v1/auth/csrf', { cookie });
  const jar = cookieJar();
  jar.update(csrf.headers);
  const headers = {
    cookie: `${cookie}; ${jar.header()}`,
    origin: config.origin,
    'x-csrf-token': csrf.body.csrfToken as string,
  };
  const path = '/api/v1/notifications';
  keys.push(
    digest(`notifications:read:${owner}`),
    digest(`notifications:write:${owner}`),
  );
  assert.equal((await request(app, 'GET', path)).status, 401);
  assert.equal(
    (
      await request(
        app,
        'PATCH',
        `${path}/${row.id}/read`,
        { cookie, origin: config.origin },
        { read: true },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(app, 'PATCH', `${path}/${foreign.id}/read`, headers, {
        read: true,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await request(app, 'PATCH', `${path}/${row.id}/read`, headers, {
        read: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(app, 'GET', `${path}/summary`, headers)).body.unreadCount,
    0,
  );
  assert.equal(
    (await request(app, 'GET', path + '?userId=' + stranger, headers)).status,
    400,
  );
  assert.equal(
    (
      await request(app, 'PATCH', `${path}/preferences`, headers, {
        watchlistActivityEnabled: false,
      })
    ).status,
    200,
  );
  assert.equal(
    (await request(app, 'POST', `${path}/read-all`, headers, {})).body
      .updatedCount,
    0,
  );
  const readKey = digest(`notifications:read:${owner}`);
  await db.authRateLimit.updateMany({
    where: { key: readKey },
    data: { count: 60 },
  });
  const limited = await request(app, 'GET', path, headers);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers['retry-after']) > 0);
  await db.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });
  assert.equal((await request(app, 'GET', path, headers)).status, 401);
  await db.session.update({
    where: { id: session.id },
    data: { revokedAt: null, expiresAt: new Date(0) },
  });
  assert.equal(
    (
      await request(app, 'PATCH', `${path}/${row.id}/read`, headers, {
        read: false,
      })
    ).status,
    401,
  );
});
