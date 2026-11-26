import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const raw = process.env.TEST_DATABASE_URL;
if (!raw) throw new Error('Explicit local TEST_DATABASE_URL required');
const target = new URL(raw);
if (
  !['postgres:', 'postgresql:'].includes(target.protocol) ||
  !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) ||
  target.pathname !== '/marketpulse_test' ||
  target.search ||
  target.hash
)
  throw new Error(
    'Release rehearsal requires local marketpulse_test without overrides',
  );
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const source = fileURLToPath(
  new URL('../../prisma/migrations/', import.meta.url),
);
const e1 = '20261125000100_notification_foundation';
const execute = promisify(execFile);

test('real Prisma CLI upgrades legacy data, reruns idempotently, matches schema and remains compatible with old writers', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'marketpulse-release-rehearsal-'),
  );
  const migrations = join(directory, 'migrations');
  const schema = `mp_e5_${randomUUID().replaceAll('-', '')}`;
  const client = new pg.Client({ connectionString: raw });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    for (const name of (await readdir(source)).filter(
      (name) => name < e1 || name === 'migration_lock.toml',
    ))
      await cp(join(source, name), join(migrations, name), { recursive: true });
    const url = new URL(raw);
    url.searchParams.set('schema', schema);
    const config = join(directory, 'prisma.config.ts');
    await writeFile(
      config,
      'export default ' +
        JSON.stringify({
          schema: join(root, 'apps/api/prisma/schema.prisma'),
          migrations: { path: migrations },
          datasource: { url: url.href },
        }) +
        ';\n',
      { mode: 0o600 },
    );
    const cli = async (args: string[]) => {
      try {
        return await execute(
          process.execPath,
          [
            join(root, 'node_modules/prisma/build/index.js'),
            ...args,
            '--config',
            config,
          ],
          {
            cwd: root,
            timeout: 60_000,
            maxBuffer: 1024 * 1024,
            env: {
              ...process.env,
              DATABASE_URL: url.href,
              DIRECT_DATABASE_URL: url.href,
              DOTENV_CONFIG_PATH: join(directory, 'absent-env'),
              DOTENV_CONFIG_OVERRIDE: 'false',
            },
          },
        );
      } catch {
        // Do not include command environment/DSN in a failure report.
        throw new Error('Isolated Prisma migration rehearsal command failed');
      }
    };
    await cli(['migrate', 'deploy']);
    const owner = randomUUID(),
      notification = randomUUID();
    await client.query(
      'INSERT INTO users (id,email,"passwordHash","displayName","updatedAt") VALUES ($1,$2,$3,$4,now())',
      [
        owner,
        `${owner}@e5.test`,
        'unused legacy fixture hash',
        'Preserved owner',
      ],
    );
    await client.query(
      'INSERT INTO notifications (id,"userId",message,"readAt") VALUES ($1,$2,$3,$4)',
      [
        notification,
        owner,
        'Original retained history',
        '2026-01-01T00:00:00Z',
      ],
    );
    const before = (
      await client.query(
        'SELECT id,"userId",message,"readAt","createdAt" FROM notifications',
      )
    ).rows;
    await client.query(
      await readFile(
        join(root, 'docs/releases/notifications-before.sql'),
        'utf8',
      ),
    );
    await cp(join(source, e1), join(migrations, e1), { recursive: true });
    await cli(['migrate', 'deploy']);
    const checks = await client.query(
      await readFile(
        join(root, 'docs/releases/notifications-after.sql'),
        'utf8',
      ),
    );
    const reports = Array.isArray(checks) ? checks : [checks];
    assert.deepEqual(
      reports
        .flatMap((report) => report.rows ?? [])
        .filter((row) => 'problem' in row),
      [],
    );
    assert.deepEqual(
      (
        await client.query(
          'SELECT id,"userId",message,"readAt","createdAt" FROM notifications',
        )
      ).rows,
      before,
    );
    assert.deepEqual(
      (
        await client.query(
          'SELECT kind,"eventKey","subjectType","subjectId" FROM notifications',
        )
      ).rows,
      [{ kind: 'LEGACY', eventKey: null, subjectType: null, subjectId: null }],
    );
    assert.equal(
      (
        await client.query(
          'SELECT count(*)::int AS count FROM notification_preferences',
        )
      ).rows[0].count,
      0,
    );
    await cli(['migrate', 'deploy']);
    assert.equal(
      (
        await client.query(
          'SELECT count(*)::int AS count FROM _prisma_migrations WHERE migration_name=$1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL',
          [e1],
        )
      ).rows[0].count,
      1,
    );
    assert.equal(
      (
        await client.query(
          'SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL',
        )
      ).rows[0].count,
      0,
    );
    await cli([
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      join(root, 'apps/api/prisma/schema.prisma'),
      '--exit-code',
    ]);
    // Roll back application behavior, retain additive schema: old SQL still works.
    await client.query(
      'INSERT INTO notifications (id,"userId",message) VALUES ($1,$2,$3)',
      [randomUUID(), owner, 'Old writer remains compatible'],
    );
    await client.query(
      'INSERT INTO watchlists (id,"userId",name) VALUES ($1,$2,$3)',
      [randomUUID(), owner, 'Old application list'],
    );
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM notifications WHERE kind='LEGACY'",
        )
      ).rows[0].count,
      2,
    );
  } finally {
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
