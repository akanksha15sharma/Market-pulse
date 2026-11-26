import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { NotificationEventKind } from '@marketpulse/contracts';
import { createDatabaseClient } from '../../src/db/client.js';
import { createAuthRepository } from '../../src/modules/auth/repository.js';
import { createAuthService } from '../../src/modules/auth/service.js';
import { createWatchlistService } from '../../src/modules/watchlists/service.js';
import { createNotificationService } from '../../src/modules/notifications/service.js';
import { recordNotification } from '../../src/modules/notifications/producer.js';
import { notificationTransaction } from '../../src/modules/notifications/transaction.js';
import { digest, hashPassword } from '../../src/modules/auth/security.js';
import { HttpError } from '../../src/lib/http-error.js';

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
    'Producer tests require local marketpulse_test without overrides',
  );
const db = createDatabaseClient(raw),
  secondDb = createDatabaseClient(raw);
const repo = createAuthRepository(db),
  secondRepo = createAuthRepository(secondDb);
const lists = createWatchlistService(db),
  secondLists = createWatchlistService(secondDb);
const inbox = createNotificationService(db, 'a'.repeat(64));
const users: string[] = [],
  assets: string[] = [],
  emails: string[] = [];
const expiry = () => new Date(Date.now() + 3600_000);
const status = (code: number) => (error: unknown) =>
  error instanceof HttpError && error.status === code;
const password = 'a long local test passphrase';
let passwordHash: string;
before(async () => {
  await db.$connect();
  await secondDb.$connect();
  passwordHash = await hashPassword(password);
});
after(async () => {
  try {
    await db.user.deleteMany({
      where: { OR: [{ id: { in: users } }, { email: { in: emails } }] },
    });
    await db.asset.deleteMany({ where: { id: { in: assets } } });
  } finally {
    await Promise.all([db.$disconnect(), secondDb.$disconnect()]);
  }
});
function email() {
  const value = `${randomUUID()}@e3.test`;
  emails.push(value);
  return value;
}
async function user() {
  const row = await db.user.create({
    data: { email: email(), displayName: 'Isolated E3 fixture', passwordHash },
  });
  users.push(row.id);
  return row;
}
async function session(userId: string) {
  return db.session.create({
    data: { userId, tokenHash: digest(randomUUID()), expiresAt: expiry() },
  });
}
async function token(
  userId: string,
  purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD',
) {
  return db.authToken.create({
    data: {
      userId,
      purpose,
      tokenHash: digest(randomUUID()),
      expiresAt: expiry(),
    },
  });
}
async function asset() {
  const row = await db.asset.create({
    data: {
      key: `e3-test:${randomUUID()}`,
      symbol: 'E3TEST',
      name: 'Local fixture only',
      type: 'CRYPTO',
      isDemoOnly: false,
    },
  });
  assets.push(row.id);
  return row;
}
const count = (userId: string, kind?: NotificationEventKind) =>
  db.notification.count({ where: { userId, ...(kind ? { kind } : {}) } });
// Force a real database insert failure, only in this guarded disposable database.
// NOT VALID preserves existing fixtures while the temporary check rejects new rows.
async function rejecting(
  kind: NotificationEventKind,
  run: () => Promise<void>,
  userId?: string,
) {
  const name = `e3_reject_${randomUUID().replaceAll('-', '')}`;
  const kinds: NotificationEventKind[] = [
    'ACCOUNT_CREATED',
    'SIGNED_IN',
    'SESSION_REVOKED',
    'PASSWORD_RESET',
    'EMAIL_VERIFIED',
    'WATCHLIST_CREATED',
    'WATCHLIST_RENAMED',
    'WATCHLIST_DELETED',
    'WATCHLIST_ASSET_ADDED',
    'WATCHLIST_ASSET_REMOVED',
  ];
  assert.ok(kinds.includes(kind));
  if (userId) assert.match(userId, /^[a-f0-9-]{36}$/);
  await db.$executeRawUnsafe(
    `ALTER TABLE notifications ADD CONSTRAINT "${name}" CHECK (kind <> '${kind}'${userId ? ` OR "userId" <> '${userId}'::uuid` : ''}) NOT VALID`,
  );
  try {
    await run();
  } finally {
    await db.$executeRawUnsafe(
      `ALTER TABLE notifications DROP CONSTRAINT "${name}"`,
    );
  }
}

test('account creation and successful login create real events; failed credentials and duplicate registration create none', async () => {
  const address = email();
  const account = await repo.register(
    { email: address, displayName: 'Local account', passwordHash },
    digest(randomUUID()),
    expiry(),
  );
  users.push(account.id);
  assert.equal(await count(account.id, 'ACCOUNT_CREATED'), 1);
  assert.equal(await count(account.id, 'SIGNED_IN'), 0); // Signup session is not a separate login.
  const auth = createAuthService(
    db,
    {
      origin: 'http://localhost:5173',
      secret: 'a'.repeat(64),
      secure: false,
      ttlSeconds: 3600,
    },
    { enabled: false, async send() {} },
  );
  await assert.rejects(
    () =>
      auth.login({ email: address, password: 'incorrect password' }, undefined),
    status(401),
  );
  assert.equal(await count(account.id), 1);
  await auth.login({ email: address, password }, undefined);
  assert.equal(await count(account.id, 'SIGNED_IN'), 1);
  await assert.rejects(() =>
    repo.register(
      { email: address, displayName: 'Duplicate', passwordHash },
      digest(randomUUID()),
      expiry(),
    ),
  );
  assert.equal(await count(account.id), 2);
  const stale = { ...account, passwordHash: 'stale-password-snapshot' };
  assert.equal(await repo.login(stale, digest(randomUUID()), expiry()), null);
  assert.equal(await count(account.id), 2);
});

test('explicit revocation and logout notify once only; foreign, missing, repeated and expired actions add no notices', async () => {
  const owner = await user(),
    stranger = await user();
  const first = await session(owner.id);
  assert.equal((await repo.revoke(stranger.id, first.id)).count, 0);
  assert.equal((await repo.revoke(owner.id, randomUUID())).count, 0);
  const attempts = await Promise.all([
    repo.revoke(owner.id, first.id),
    secondRepo.revoke(owner.id, first.id),
  ]);
  assert.equal(
    attempts.reduce((sum, result) => sum + result.count, 0),
    1,
  );
  assert.equal(await count(owner.id, 'SESSION_REVOKED'), 1);
  assert.equal((await repo.revoke(owner.id, first.id)).count, 0);
  const logout = await session(owner.id);
  await Promise.all([
    repo.logout(logout.tokenHash),
    secondRepo.logout(logout.tokenHash),
  ]);
  await repo.logout(digest(randomUUID()));
  assert.equal(await count(owner.id, 'SESSION_REVOKED'), 2);
  const expired = await session(owner.id);
  await db.session.update({
    where: { id: expired.id },
    data: { expiresAt: new Date(0) },
  });
  await repo.logout(expired.tokenHash);
  assert.equal(await count(owner.id, 'SESSION_REVOKED'), 2);
  assert.equal(await count(stranger.id), 0);
});

test('session rotation, session cap and cross-account replacement report genuine revocations without deadlocks', async () => {
  const first = await user(),
    other = await user();
  const firstSession = await session(first.id),
    otherSession = await session(other.id);
  // Opposite cross-account cookie replacements acquire the same two user locks in order.
  await Promise.all([
    repo.login(first, digest(randomUUID()), expiry(), otherSession.tokenHash),
    secondRepo.login(
      other,
      digest(randomUUID()),
      expiry(),
      firstSession.tokenHash,
    ),
  ]);
  for (const owner of [first.id, other.id]) {
    assert.equal(await count(owner, 'SIGNED_IN'), 1);
    assert.equal(await count(owner, 'SESSION_REVOKED'), 1);
  }
  const capped = await user();
  await Promise.all(Array.from({ length: 10 }, () => session(capped.id)));
  await repo.login(capped, digest(randomUUID()), expiry());
  assert.equal((await repo.sessions(capped.id)).length, 10);
  assert.equal(await count(capped.id, 'SESSION_REVOKED'), 1);
  assert.equal(await count(capped.id, 'SIGNED_IN'), 1);
});

test('verification and password reset are single-use under concurrency; invalid, expired and unchanged verification produce no events', async () => {
  const owner = await user();
  const verify = await token(owner.id, 'VERIFY_EMAIL');
  const verification = await Promise.all([
    repo.verify(verify.tokenHash),
    secondRepo.verify(verify.tokenHash),
  ]);
  assert.deepEqual(verification.sort(), [false, true]);
  assert.equal(await count(owner.id, 'EMAIL_VERIFIED'), 1);
  const redundant = await token(owner.id, 'VERIFY_EMAIL');
  assert.equal(await repo.verify(redundant.tokenHash), false);
  assert.equal(await repo.verify(digest(randomUUID())), false);
  assert.equal(await count(owner.id, 'EMAIL_VERIFIED'), 1);
  await session(owner.id);
  await session(owner.id);
  const reset = await token(owner.id, 'RESET_PASSWORD');
  const resets = await Promise.all([
    repo.reset(owner.id, reset.id, 'new-test-hash'),
    secondRepo.reset(owner.id, reset.id, 'new-test-hash'),
  ]);
  assert.deepEqual(resets.sort(), [false, true]);
  assert.equal(await count(owner.id, 'PASSWORD_RESET'), 1);
  assert.equal(await count(owner.id, 'SESSION_REVOKED'), 1); // One notice, not one per session.
  assert.equal((await repo.sessions(owner.id)).length, 0);
  const expired = await token(owner.id, 'RESET_PASSWORD');
  await db.authToken.update({
    where: { id: expired.id },
    data: { expiresAt: new Date(0) },
  });
  assert.equal(await repo.reset(owner.id, expired.id, 'ignored'), false);
  assert.equal(await count(owner.id, 'PASSWORD_RESET'), 1);
  const unverified = await user();
  const expiredVerify = await token(unverified.id, 'VERIFY_EMAIL');
  await db.authToken.update({
    where: { id: expiredVerify.id },
    data: { expiresAt: new Date(0) },
  });
  assert.equal(await repo.verify(expiredVerify.tokenHash), false);
  assert.equal(await count(unverified.id), 0);
});

test('watchlist lifecycle emits all five kinds only for changed, owned, successful operations', async () => {
  const owner = await user(),
    stranger = await user();
  const item = await asset();
  const list = await lists.create(owner.id, { name: 'Original' });
  await lists.rename(owner.id, list.id, { name: ' Original ' });
  assert.equal(await count(owner.id, 'WATCHLIST_RENAMED'), 0);
  await lists.rename(owner.id, list.id, { name: 'Renamed' });
  await Promise.all([
    lists.add(owner.id, list.id, item.id),
    secondLists.add(owner.id, list.id, item.id),
  ]);
  assert.equal(await count(owner.id, 'WATCHLIST_ASSET_ADDED'), 1);
  for (const action of [
    () => lists.rename(stranger.id, list.id, { name: 'Stolen' }),
    () => lists.add(stranger.id, list.id, item.id),
    () => lists.remove(stranger.id, list.id, item.id),
    () => lists.delete(stranger.id, list.id),
    () => lists.add(owner.id, list.id, randomUUID()),
  ])
    await assert.rejects(action, status(404));
  await Promise.all([
    lists.remove(owner.id, list.id, item.id),
    secondLists.remove(owner.id, list.id, item.id),
  ]);
  await lists.remove(owner.id, list.id, item.id);
  assert.equal(await count(owner.id, 'WATCHLIST_ASSET_REMOVED'), 1);
  await lists.delete(owner.id, list.id);
  await assert.rejects(() => lists.delete(owner.id, list.id), status(404));
  const rows = await db.notification.findMany({ where: { userId: owner.id } });
  assert.equal(rows.length, 5);
  assert.deepEqual(
    new Set(rows.map((row) => row.kind)),
    new Set([
      'WATCHLIST_CREATED',
      'WATCHLIST_RENAMED',
      'WATCHLIST_DELETED',
      'WATCHLIST_ASSET_ADDED',
      'WATCHLIST_ASSET_REMOVED',
    ]),
  );
  assert.equal(await count(stranger.id), 0);
  assert.ok(
    (await inbox.history(owner.id, {})).notifications.every(
      (row) => row.actionUrl === '/watchlists',
    ),
  );
});

test('concurrent same-name renames and capacity failures cannot duplicate or invent events', async () => {
  const owner = await user();
  const list = await lists.create(owner.id, { name: 'Original' });
  await Promise.all([
    lists.rename(owner.id, list.id, { name: 'Same new name' }),
    secondLists.rename(owner.id, list.id, { name: 'Same new name' }),
  ]);
  assert.equal(await count(owner.id, 'WATCHLIST_RENAMED'), 1);
  const attempts = await Promise.allSettled(
    Array.from({ length: 6 }, (_, index) =>
      (index % 2 ? lists : secondLists).create(owner.id, {
        name: `List ${index}`,
      }),
    ),
  );
  assert.equal(attempts.filter((row) => row.status === 'fulfilled').length, 4);
  assert.equal(await count(owner.id, 'WATCHLIST_CREATED'), 5);
  // Removing then re-adding is a new genuine operation, not a duplicate of the old one.
  const item = await asset();
  await lists.add(owner.id, list.id, item.id);
  await lists.remove(owner.id, list.id, item.id);
  await lists.add(owner.id, list.id, item.id);
  assert.equal(await count(owner.id, 'WATCHLIST_ASSET_ADDED'), 2);
});

test('preferences suppress optional events but preserve business changes and mandatory security notices', async () => {
  const owner = await user();
  await inbox.patchPreferences(owner.id, {
    accountActivityEnabled: false,
    watchlistActivityEnabled: false,
  });
  await repo.login(owner, digest(randomUUID()), expiry());
  const list = await lists.create(owner.id, { name: 'Silent' });
  const item = await asset();
  await lists.rename(owner.id, list.id, { name: 'Still silent' });
  await lists.add(owner.id, list.id, item.id);
  await lists.remove(owner.id, list.id, item.id);
  await lists.delete(owner.id, list.id);
  assert.equal(await count(owner.id), 0);
  const active = await session(owner.id);
  await repo.revoke(owner.id, active.id);
  const verify = await token(owner.id, 'VERIFY_EMAIL');
  await repo.verify(verify.tokenHash);
  const reset = await token(owner.id, 'RESET_PASSWORD');
  await repo.reset(owner.id, reset.id, 'updated-hash');
  for (const kind of [
    'SESSION_REVOKED',
    'EMAIL_VERIFIED',
    'PASSWORD_RESET',
  ] as const)
    assert.ok(await count(owner.id, kind));
  assert.equal(await count(owner.id, 'SIGNED_IN'), 0);
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: owner.id } }))
      .emailAlertsEnabled,
    false,
  );
  await inbox.patchPreferences(owner.id, { watchlistActivityEnabled: true });
  await lists.create(owner.id, { name: 'Audible again' });
  assert.equal(await count(owner.id, 'WATCHLIST_CREATED'), 1);
});

test('producer deduplication survives separate connections and retries; an aborted transaction leaves no event or business update', async () => {
  const owner = await user();
  const operationId = randomUUID();
  const event = { userId: owner.id, kind: 'SIGNED_IN' as const, operationId };
  const outcomes = await Promise.all([
    notificationTransaction(db, owner.id, (tx) =>
      recordNotification(tx, event),
    ),
    notificationTransaction(secondDb, owner.id, (tx) =>
      recordNotification(tx, event),
    ),
  ]);
  assert.deepEqual(outcomes.sort(), [false, true]);
  assert.equal(await count(owner.id), 1);
  const retryId = randomUUID();
  await assert.rejects(
    () =>
      notificationTransaction(db, owner.id, async (tx) => {
        await tx.user.update({
          where: { id: owner.id },
          data: { displayName: 'Must roll back' },
        });
        await recordNotification(tx, { ...event, operationId: retryId });
        throw new Error('Rollback after event insertion');
      }),
    /Rollback after event insertion/,
  );
  assert.equal(await count(owner.id), 1);
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: owner.id } })).displayName,
    'Isolated E3 fixture',
  );
  await notificationTransaction(db, owner.id, (tx) =>
    recordNotification(tx, { ...event, operationId: retryId }),
  );
  assert.equal(await count(owner.id), 2);
  assert.equal(
    await db.notificationPreference.count({ where: { userId: owner.id } }),
    0,
  );
});

test('notification insert failure rolls back registration, login rotation, logout and explicit revocation', async () => {
  const address = email();
  await rejecting('ACCOUNT_CREATED', async () => {
    await assert.rejects(() =>
      repo.register(
        { email: address, displayName: 'Rollback', passwordHash },
        digest(randomUUID()),
        expiry(),
      ),
    );
    assert.equal(await db.user.count({ where: { email: address } }), 0);
  });
  const owner = await user();
  const active = await session(owner.id);
  await rejecting(
    'SIGNED_IN',
    async () => {
      await assert.rejects(() =>
        repo.login(owner, digest(randomUUID()), expiry(), active.tokenHash),
      );
      assert.equal(
        (await db.session.findUniqueOrThrow({ where: { id: active.id } }))
          .revokedAt,
        null,
      );
      assert.equal((await repo.sessions(owner.id)).length, 1);
      assert.equal(await count(owner.id), 0); // Earlier session-revoked event also rolled back.
    },
    owner.id,
  );
  await rejecting(
    'SESSION_REVOKED',
    async () => {
      await assert.rejects(() => repo.logout(active.tokenHash));
      await assert.rejects(() => repo.revoke(owner.id, active.id));
      assert.equal(
        (await db.session.findUniqueOrThrow({ where: { id: active.id } }))
          .revokedAt,
        null,
      );
    },
    owner.id,
  );
});

test('notification failure rolls back verification/reset token consumption, credential changes and session revocations', async () => {
  const owner = await user();
  const active = await session(owner.id);
  const verify = await token(owner.id, 'VERIFY_EMAIL');
  await rejecting(
    'EMAIL_VERIFIED',
    async () => {
      await assert.rejects(() => repo.verify(verify.tokenHash));
      assert.equal(
        (await db.authToken.findUniqueOrThrow({ where: { id: verify.id } }))
          .consumedAt,
        null,
      );
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: owner.id } }))
          .emailVerifiedAt,
        null,
      );
    },
    owner.id,
  );
  const reset = await token(owner.id, 'RESET_PASSWORD');
  await rejecting(
    'PASSWORD_RESET',
    async () => {
      await assert.rejects(() =>
        repo.reset(owner.id, reset.id, 'must-not-save'),
      );
      assert.equal(
        (await db.authToken.findUniqueOrThrow({ where: { id: reset.id } }))
          .consumedAt,
        null,
      );
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: owner.id } }))
          .passwordHash,
        passwordHash,
      );
      assert.equal(
        (await db.session.findUniqueOrThrow({ where: { id: active.id } }))
          .revokedAt,
        null,
      );
      assert.equal(await count(owner.id), 0);
    },
    owner.id,
  );
});

test('notification failure rolls back every watchlist operation including deletion cascades', async () => {
  const owner = await user();
  const item = await asset();
  await rejecting(
    'WATCHLIST_CREATED',
    async () => {
      await assert.rejects(() =>
        lists.create(owner.id, { name: 'Must not exist' }),
      );
      assert.equal(
        await db.watchlist.count({ where: { userId: owner.id } }),
        0,
      );
    },
    owner.id,
  );
  const list = await lists.create(owner.id, { name: 'Original' });
  await rejecting(
    'WATCHLIST_RENAMED',
    async () => {
      await assert.rejects(() =>
        lists.rename(owner.id, list.id, { name: 'Must not save' }),
      );
      assert.equal((await lists.get(owner.id, list.id)).name, 'Original');
    },
    owner.id,
  );
  await rejecting(
    'WATCHLIST_ASSET_ADDED',
    async () => {
      await assert.rejects(() => lists.add(owner.id, list.id, item.id));
      assert.equal((await lists.get(owner.id, list.id)).items.length, 0);
    },
    owner.id,
  );
  await lists.add(owner.id, list.id, item.id);
  await rejecting(
    'WATCHLIST_ASSET_REMOVED',
    async () => {
      await assert.rejects(() => lists.remove(owner.id, list.id, item.id));
      assert.equal((await lists.get(owner.id, list.id)).items.length, 1);
    },
    owner.id,
  );
  await rejecting(
    'WATCHLIST_DELETED',
    async () => {
      await assert.rejects(() => lists.delete(owner.id, list.id));
      assert.equal((await lists.get(owner.id, list.id)).items.length, 1);
    },
    owner.id,
  );
  assert.equal(await count(owner.id), 2); // Only successful create and add.
});

test('preferences and producers share the same account lock, so a committed opt-out suppresses a waiting operation', async () => {
  const owner = await user();
  let release!: () => void, locked!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const acquired = new Promise<void>((done) => {
    locked = done;
  });
  const update = notificationTransaction(db, owner.id, async (tx) => {
    await tx.notificationPreference.create({
      data: { userId: owner.id, watchlistActivityEnabled: false },
    });
    locked();
    await gate;
  });
  await acquired;
  const creation = secondLists.create(owner.id, { name: 'After opt-out' });
  release();
  await Promise.all([update, creation]);
  assert.equal(await count(owner.id), 0);
  assert.equal(await db.watchlist.count({ where: { userId: owner.id } }), 1);
});
