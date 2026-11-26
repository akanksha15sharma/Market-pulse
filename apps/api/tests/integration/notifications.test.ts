import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import pg from 'pg';
import { notificationEventKey } from '@marketpulse/contracts';
import { createDatabaseClient } from '../../src/db/client.js';

// Never inherit the application datasource or accept connection-string overrides.
const raw = process.env.TEST_DATABASE_URL;
if (!raw) throw new Error('TEST_DATABASE_URL must name local marketpulse_test');
const target = new URL(raw);
if (
  !['postgres:', 'postgresql:'].includes(target.protocol) ||
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  target.pathname !== '/marketpulse_test' ||
  target.search ||
  target.hash
)
  throw new Error(
    'E1 database tests require localhost marketpulse_test without URL overrides',
  );
const db = createDatabaseClient(raw);
const users: string[] = [];
const migrationName = '20261125000100_notification_foundation';
const directory = new URL('../../prisma/migrations/', import.meta.url);
const migration = await readFile(
  new URL(`${migrationName}/migration.sql`, directory),
  'utf8',
);
before(async () => {
  await db.$connect();
});
after(async () => {
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});
async function user() {
  const result = await db.user.create({
    data: {
      email: `${randomUUID()}@e1.test`,
      displayName: 'E1 isolated fixture',
      passwordHash: 'not-a-login-password',
    },
  });
  users.push(result.id);
  return result;
}
function event(userId: string, operation = randomUUID()) {
  return {
    userId,
    kind: 'SIGNED_IN' as const,
    eventKey: notificationEventKey('SIGNED_IN', operation),
    subjectType: 'ACCOUNT' as const,
    subjectId: userId,
    message: 'Isolated successful sign-in fixture',
  };
}
async function oldSchema(run: (client: pg.Client) => Promise<void>) {
  const schema = `mp_e1_${randomUUID().replaceAll('-', '')}`;
  const client = new pg.Client({ connectionString: raw });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    for (const name of (await readdir(directory))
      .filter((name) => /^\d/.test(name) && name < migrationName)
      .sort())
      await client.query(
        await readFile(new URL(`${name}/migration.sql`, directory), 'utf8'),
      );
    await run(client);
  } finally {
    await client.query('ROLLBACK');
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}
async function legacyFixture(client: pg.Client) {
  const owner = randomUUID(),
    asset = randomUUID(),
    list = randomUUID(),
    alert = randomUUID(),
    alertEvent = randomUUID();
  await client.query(
    'INSERT INTO users (id,email,"passwordHash","displayName","updatedAt","emailAlertsEnabled") VALUES ($1,$2,$3,$4,$5,true)',
    [
      owner,
      `${owner}@legacy.test`,
      'unchanged hash',
      'Legacy owner',
      '2026-01-01T00:00:00Z',
    ],
  );
  await client.query(
    'INSERT INTO sessions (id,"userId","tokenHash","expiresAt") VALUES ($1,$2,$3,$4)',
    [randomUUID(), owner, randomUUID(), '2027-01-01T00:00:00Z'],
  );
  await client.query(
    "INSERT INTO assets (id,key,type,symbol,name,\"isDemoOnly\") VALUES ($1,$2,'STOCK','AAPL','Apple',true)",
    [asset, `legacy:${asset}`],
  );
  await client.query(
    'INSERT INTO watchlists (id,"userId",name) VALUES ($1,$2,\'Preserved list\')',
    [list, owner],
  );
  await client.query(
    'INSERT INTO watchlist_items ("watchlistId","assetId") VALUES ($1,$2)',
    [list, asset],
  );
  await client.query(
    "INSERT INTO price_alerts (id,\"userId\",\"assetId\",provider,mode,direction,threshold) VALUES ($1,$2,$3,'DEMO','DEMO','ABOVE',100)",
    [alert, owner, asset],
  );
  await client.query(
    'INSERT INTO alert_events (id,"alertId",activation,"observedPrice","sourceAt") VALUES ($1,$2,1,100,$3)',
    [alertEvent, alert, '2026-01-01T00:00:00Z'],
  );
  for (const [ref, message, readAt] of [
    [null, 'Original unread message', null],
    [alertEvent, 'Original linked message', '2026-01-02T00:00:00Z'],
    [null, '', null],
  ])
    await client.query(
      'INSERT INTO notifications (id,"userId","alertEventId",message,"createdAt","readAt") VALUES ($1,$2,$3,$4,$5,$6)',
      [randomUUID(), owner, ref, message, '2026-01-01T00:00:00Z', readAt],
    );
  return owner;
}
async function snapshot(client: pg.Client) {
  const result: Record<string, unknown> = {};
  for (const table of [
    'users',
    'sessions',
    'assets',
    'watchlists',
    'watchlist_items',
    'price_alerts',
    'alert_events',
  ])
    result[table] = (
      await client.query(
        `SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY to_jsonb(t)::text`,
      )
    ).rows;
  result.notifications = (
    await client.query(
      'SELECT id,"userId","alertEventId",message,"readAt","createdAt" FROM notifications ORDER BY id',
    )
  ).rows;
  return result;
}

test('all migrations install the E1 foundation with existing and new indexes', async () => {
  const row = await db.$queryRaw<
    { finished_at: Date | null }[]
  >`SELECT finished_at FROM _prisma_migrations WHERE migration_name=${migrationName}`;
  assert.ok(row[0]?.finished_at);
  const indexes = await db.$queryRaw<
    { indexname: string }[]
  >`SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='notifications'`;
  for (const name of [
    'notifications_userId_alertEventId_key',
    'notifications_userId_createdAt_idx',
    'notifications_userId_eventKey_key',
    'notifications_userId_createdAt_id_idx',
    'notifications_userId_readAt_createdAt_id_idx',
  ])
    assert.ok(
      indexes.some((row) => row.indexname === name),
      name,
    );
});

test('upgrade preserves complete legacy records, IDs, messages, read flags and inactive price functionality', async () => {
  await oldSchema(async (client) => {
    await legacyFixture(client);
    const before = await snapshot(client);
    await client.query(migration);
    assert.deepEqual(await snapshot(client), before);
    const rows = (
      await client.query(
        'SELECT kind,"eventKey","subjectType","subjectId" FROM notifications',
      )
    ).rows;
    assert.equal(rows.length, 3);
    for (const row of rows)
      assert.deepEqual(row, {
        kind: 'LEGACY',
        eventKey: null,
        subjectType: null,
        subjectId: null,
      });
    assert.equal(
      (
        await client.query(
          'SELECT count(*)::int AS n FROM notification_preferences',
        )
      ).rows[0].n,
      0,
      'Migration must not manufacture preferences or activity',
    );
    // A pre-E1 writer can still create a legacy row using only old columns.
    const owner = (await client.query('SELECT id FROM users')).rows[0].id;
    await client.query(
      'INSERT INTO notifications (id,"userId",message) VALUES ($1,$2,\'Old writer fixture\')',
      [randomUUID(), owner],
    );
    assert.equal(
      (await client.query('SELECT count(*)::int AS n FROM notifications'))
        .rows[0].n,
      4,
    );
    const kinds = (
      await client.query(
        'SELECT enumlabel FROM pg_enum WHERE enumtypid=\'"NotificationKind"\'::regtype',
      )
    ).rows.map((row) => row.enumlabel);
    assert.equal(
      kinds.some((kind) => kind.includes('PRICE')),
      false,
    );
  });
});

test('an interrupted additive migration rolls back its DDL and preserves baseline data', async () => {
  await oldSchema(async (client) => {
    await legacyFixture(client);
    const before = await snapshot(client);
    await assert.rejects(
      client.query(migration.replace('COMMIT;', 'SELECT 1/0; COMMIT;')),
    );
    await client.query('ROLLBACK');
    assert.deepEqual(await snapshot(client), before);
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='notifications' AND column_name='kind'",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await client.query(
          "SELECT to_regclass('notification_preferences') AS name",
        )
      ).rows[0].name,
      null,
    );
  });
});

test('deduplication is enforced under concurrent writes but remains recipient-scoped', async () => {
  const a = await user(),
    b = await user(),
    input = event(a.id);
  const results = await Promise.allSettled([
    db.notification.create({ data: input }),
    db.notification.create({ data: input }),
  ]);
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    await db.notification.count({
      where: { userId: a.id, eventKey: input.eventKey },
    }),
    1,
  );
  await db.notification.create({
    data: { ...input, userId: b.id, subjectId: b.id },
  });
  assert.equal(
    await db.notification.count({ where: { eventKey: input.eventKey } }),
    2,
  );
  await db.notification.createMany({
    data: [
      { userId: a.id, message: 'Legacy A' },
      { userId: a.id, message: 'Legacy B' },
    ],
  });
  assert.equal(
    await db.notification.count({ where: { userId: a.id, kind: 'LEGACY' } }),
    2,
  );
});

test('database constraints reject missing keys, mismatched subjects, empty events and new price references', async () => {
  const owner = await user(),
    input = event(owner.id);
  for (const override of [
    { eventKey: null },
    { eventKey: ' ' },
    { eventKey: notificationEventKey('ACCOUNT_CREATED', randomUUID()) },
    { eventKey: input.eventKey!.toUpperCase() },
    { subjectId: null },
    { subjectType: null },
    { subjectType: 'WATCHLIST' as const },
    { subjectId: randomUUID() },
    { message: ' \t\n' },
    { kind: 'LEGACY' as const },
  ])
    await assert.rejects(
      db.notification.create({ data: { ...input, ...override } }),
    );
  await assert.rejects(
    db.$executeRaw`INSERT INTO notifications (id,"userId",kind,message) VALUES (${randomUUID()}::uuid,${owner.id}::uuid,'PRICE_ALERT','Not allowed')`,
  );
  // A legacy reference must remain valid, but cannot be relabelled as new account activity.
  const asset = await db.asset.create({
    data: {
      key: `e1:${randomUUID()}`,
      type: 'STOCK',
      symbol: 'E1',
      name: 'Isolated E1 asset',
      isDemoOnly: true,
    },
  });
  try {
    const alert = await db.priceAlert.create({
      data: {
        userId: owner.id,
        assetId: asset.id,
        provider: 'DEMO',
        mode: 'DEMO',
        direction: 'ABOVE',
        threshold: '100',
      },
    });
    const saved = await db.alertEvent.create({
      data: {
        alertId: alert.id,
        activation: 1,
        observedPrice: '100',
        sourceAt: new Date(),
      },
    });
    await db.notification.create({
      data: {
        userId: owner.id,
        alertEventId: saved.id,
        message: 'Legacy link retained',
      },
    });
    await assert.rejects(
      db.notification.create({
        data: { ...event(owner.id), alertEventId: saved.id },
      }),
    );
    await db.priceAlert.delete({ where: { id: alert.id } });
  } finally {
    await db.asset.delete({ where: { id: asset.id } });
  }
});

test('preferences are lazy, default on, unique per owner, and do not change email opt-in', async () => {
  const owner = await user();
  assert.equal(
    await db.notificationPreference.findUnique({ where: { userId: owner.id } }),
    null,
  );
  const prefs = await db.notificationPreference.create({
    data: { userId: owner.id },
  });
  assert.equal(prefs.accountActivityEnabled, true);
  assert.equal(prefs.watchlistActivityEnabled, true);
  assert.ok(prefs.updatedAt);
  await assert.rejects(
    db.notificationPreference.create({ data: { userId: owner.id } }),
  );
  await assert.rejects(
    db.notificationPreference.create({ data: { userId: randomUUID() } }),
  );
  const disabled = await db.notificationPreference.update({
    where: { userId: owner.id },
    data: { watchlistActivityEnabled: false },
  });
  assert.equal(disabled.watchlistActivityEnabled, false);
  assert.equal(disabled.accountActivityEnabled, true);
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: owner.id } }))
      .emailAlertsEnabled,
    false,
  );
});

test('snapshot subjects survive watchlist deletion; owner deletion keeps existing cascade semantics', async () => {
  const owner = await user();
  const list = await db.watchlist.create({
    data: { userId: owner.id, name: 'Isolated list' },
  });
  const saved = await db.notification.create({
    data: {
      userId: owner.id,
      kind: 'WATCHLIST_DELETED',
      eventKey: notificationEventKey('WATCHLIST_DELETED', randomUUID()),
      subjectType: 'WATCHLIST',
      subjectId: list.id,
      message: 'Isolated completed deletion fixture',
    },
  });
  await db.notificationPreference.create({ data: { userId: owner.id } });
  await db.watchlist.delete({ where: { id: list.id } });
  assert.equal(
    (await db.notification.findUniqueOrThrow({ where: { id: saved.id } }))
      .subjectId,
    list.id,
  );
  await db.user.delete({ where: { id: owner.id } });
  assert.equal(await db.notification.count({ where: { userId: owner.id } }), 0);
  assert.equal(
    await db.notificationPreference.count({ where: { userId: owner.id } }),
    0,
  );
});
