import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseRuntimeEnv,
  validateProductionEnv,
} from '../../src/config/runtime-env.js';

const production = {
  NODE_ENV: 'production',
  APP_ORIGIN: 'https://marketpulse.example',
  CSRF_SECRET: 'a'.repeat(64),
};

test('production requires an exact HTTPS origin, stable secret, and disabled local email', () => {
  const parsed = parseRuntimeEnv(production);
  assert.equal(parsed.PORT, 3001);
  assert.deepEqual(parsed.TRUSTED_PROXIES, []);
  assert.equal(parsed.EMAIL_MODE, 'disabled');
  for (const input of [
    { ...production, CSRF_SECRET: undefined },
    { ...production, CSRF_SECRET: 'short' },
    { ...production, APP_ORIGIN: 'http://marketpulse.example' },
    { ...production, APP_ORIGIN: 'https://marketpulse.example/' },
    { ...production, APP_ORIGIN: 'https://marketpulse.example/path' },
    { ...production, APP_ORIGIN: 'https://user:password@marketpulse.example' },
    { ...production, EMAIL_MODE: 'mailpit' },
  ])
    assert.throws(() => parseRuntimeEnv(input));
});

test('proxy configuration accepts explicit IPs/CIDRs and rejects blanket or invalid trust', () => {
  assert.deepEqual(
    parseRuntimeEnv({
      ...production,
      TRUSTED_PROXIES: '127.0.0.1, ::1, 10.20.0.0/16',
    }).TRUSTED_PROXIES,
    ['127.0.0.1', '::1', '10.20.0.0/16'],
  );
  for (const value of [
    'true',
    '*',
    '1',
    '0.0.0.0/0',
    '::/0',
    'proxy.example',
    '127.0.0.1/33',
    '::1/129',
    '127.0.0.1/1/2',
  ])
    assert.throws(() =>
      parseRuntimeEnv({ ...production, TRUSTED_PROXIES: value }),
    );
});

test('development remains usable with loopback Mailpit and validates ports and origin protocols', () => {
  assert.equal(
    parseRuntimeEnv({ EMAIL_MODE: 'mailpit' }).EMAIL_MODE,
    'mailpit',
  );
  for (const input of [
    { PORT: '0' },
    { PORT: '65536' },
    { APP_ORIGIN: 'ftp://localhost' },
    { EMAIL_MODE: 'mailpit', MAILPIT_URL: 'https://external.example' },
  ])
    assert.throws(() => parseRuntimeEnv(input));
});

test('production preflight validates database URLs without connecting or leaking credentials', () => {
  const input = {
    ...production,
    DATABASE_URL:
      'postgresql://user:private-secret@db.invalid/marketpulse?sslmode=verify-full',
  };
  assert.equal(validateProductionEnv(input).NODE_ENV, 'production');
  assert.doesNotThrow(() =>
    validateProductionEnv({
      ...input,
      DIRECT_DATABASE_URL: 'postgres://db.invalid/marketpulse',
    }),
  );
  for (const invalid of [
    { ...input, NODE_ENV: 'development' },
    { ...input, DATABASE_URL: undefined },
    {
      ...input,
      DATABASE_URL: 'mysql://user:private-secret@db.invalid/marketpulse',
    },
    { ...input, DATABASE_URL: 'postgresql://db.invalid/' },
    { ...input, DIRECT_DATABASE_URL: '' },
  ]) {
    assert.throws(
      () => validateProductionEnv(invalid),
      (error: unknown) =>
        error instanceof Error && !error.message.includes('private-secret'),
    );
  }
});

test('production preflight CLI exits safely for valid and invalid configuration', () => {
  const input = {
    ...production,
    DATABASE_URL: 'postgresql://user:private-secret@db.invalid/marketpulse',
    DIRECT_DATABASE_URL:
      'postgresql://user:private-secret@db.invalid/marketpulse',
    EMAIL_MODE: 'disabled',
    CRYPTO_DATA_MODE: 'demo',
    STOCK_DATA_MODE: 'demo',
    TRUSTED_PROXIES: '',
  };
  for (const [overrides, expected] of [
    [{}, 0],
    [{ CSRF_SECRET: 'private-short-secret' }, 1],
    [{ DATABASE_URL: '' }, 1],
    [{ CRYPTO_DATA_MODE: 'unknown' }, 1],
  ] as const) {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'src/tools/check-production.ts'],
      {
        env: { ...process.env, ...input, ...overrides },
        encoding: 'utf8',
        timeout: 15_000,
      },
    );
    assert.equal(result.status, expected, result.stderr);
    const output = result.stdout + result.stderr;
    assert.doesNotMatch(
      output,
      /private-secret|private-short-secret|db.invalid/,
    );
    assert.match(
      output,
      expected === 0 ? /No database connection/ : /configuration is invalid/,
    );
  }
});
