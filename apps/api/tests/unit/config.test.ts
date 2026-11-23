import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRuntimeEnv } from '../../src/config/runtime-env.js';

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
