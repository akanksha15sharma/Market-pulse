// Optional user-space PostgreSQL runner. No downloads, sudo, system services or production URLs.
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = fileURLToPath(new URL('../', import.meta.url));
const selected = process.env.MP_TEST_PG_BIN;
if (!selected)
  throw new Error(
    'Set MP_TEST_PG_BIN to reviewed PostgreSQL 17 binaries (initdb, pg_ctl, postgres). See docs/notifications-e1.md.',
  );
if (process.getuid?.() === 0)
  throw new Error(
    'Run this test tool as a normal user; it never creates system users.',
  );
const bin = resolve(selected);
const postgres = join(bin, 'postgres');
const version = execFileSync(postgres, ['--version'], {
  encoding: 'utf8',
}).trim();
if (!/^postgres \(PostgreSQL\) 17\./.test(version))
  throw new Error('The local test runner requires PostgreSQL 17.');
const temporary = await mkdtemp(join(tmpdir(), 'marketpulse-local-db-'));
const cluster = join(temporary, 'cluster');
const password = randomBytes(32).toString('hex');
const passwordFile = join(temporary, 'password');
await writeFile(passwordFile, password, { mode: 0o600 });
const probe = createServer();
await new Promise((done, reject) => {
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', done);
});
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const connection = new URL('postgresql://127.0.0.1/marketpulse_test');
connection.port = String(port);
connection.username = 'marketpulse';
connection.password = password;
const env = {
  ...process.env,
  PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
  DATABASE_URL: connection.href,
  DIRECT_DATABASE_URL: connection.href,
  TEST_DATABASE_URL: connection.href,
  NODE_ENV: 'test',
  APP_ORIGIN: 'http://127.0.0.1:5173',
  CSRF_SECRET: 'a'.repeat(64),
  EMAIL_MODE: 'disabled',
  MARKET_WORKER_ENABLED: 'false',
  MARKET_ALWAYS_ON: 'false',
  DOTENV_CONFIG_PATH: join(temporary, 'absent-env'),
  DOTENV_CONFIG_QUIET: 'true',
};
delete env.DOTENV_CONFIG_OVERRIDE;
// Explicit options stop libpq/pg environment defaults from selecting another host.
const databaseOptions = {
  host: '127.0.0.1',
  port,
  user: 'marketpulse',
  password,
  database: 'postgres',
  ssl: false,
  connectionTimeoutMillis: 5000,
};
let child;
let interrupted = false;
function interrupt() {
  interrupted = true;
  child?.kill('SIGTERM');
}
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
function run(command, args, output = 'inherit') {
  if (interrupted)
    return Promise.reject(new Error('Local test run interrupted'));
  return new Promise((done, reject) => {
    child = spawn(command, args, { cwd: root, env, stdio: output });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      child = undefined;
      if (code === 0) done();
      else
        reject(
          new Error(
            `Local test command failed: ${command} (exit ${code}, signal ${signal ?? 'none'})`,
          ),
        );
    });
  });
}
let started = false;
try {
  await run(
    join(bin, 'initdb'),
    [
      '-D',
      cluster,
      '-U',
      'marketpulse',
      `--pwfile=${passwordFile}`,
      '--auth=scram-sha-256',
      '--encoding=UTF8',
      '--locale=C',
    ],
    'ignore',
  );
  await run(join(bin, 'pg_ctl'), [
    '-D',
    cluster,
    '-l',
    join(temporary, 'postgres.log'),
    '-o',
    `-h 127.0.0.1 -p ${port} -c unix_socket_directories='' -c max_connections=30 -c shared_buffers=32MB -c timezone=UTC -c log_timezone=UTC`,
    '-w',
    'start',
  ]);
  started = true;
  const db = new pg.Client(databaseOptions);
  try {
    await db.connect();
    await db.query('CREATE DATABASE marketpulse_test');
  } finally {
    await db.end();
  }
  console.log(
    `${version}; isolated marketpulse_test on loopback port ${port}. No system settings changed.`,
  );
  console.log(`Temporary cluster and log directory: ${temporary}`);
  await run('npm', ['run', 'db:generate']);
  await run('npm', ['run', 'build', '-w', '@marketpulse/contracts']);
  for (const name of [
    'db:deploy',
    'test:db',
    'test:auth:db',
    'test:markets:db',
    'test:watchlists:db',
    'test:alerts:db',
    'test:notifications:db',
  ])
    await run('npm', ['run', name]);
  console.log('All isolated database migration and integration suites passed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = interrupted ? 130 : 1;
} finally {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  if (started) {
    try {
      execFileSync(
        join(bin, 'pg_ctl'),
        ['-D', cluster, '-m', 'fast', '-w', 'stop'],
        { stdio: 'inherit', env },
      );
    } catch {
      console.error(
        `Stop the test cluster with pg_ctl -D ${cluster} -m fast -w stop`,
      );
      process.exitCode = 1;
    }
  }
}
