import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createDatabaseClient } from '../../src/db/client.js';
import { createAuthService } from '../../src/modules/auth/service.js';
import { digest } from '../../src/modules/auth/security.js';
import type { AuthConfig } from '../../src/config/env.js';
import type { AuthMail } from '../../src/email/auth-mailer.js';
import { HttpError } from '../../src/lib/http-error.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Explicit local TEST_DATABASE_URL is required');
const target = new URL(url);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  target.pathname !== '/marketpulse_test'
)
  throw new Error('Auth integration tests require local marketpulse_test');
const db = createDatabaseClient(url);
const config: AuthConfig = {
  origin: 'http://localhost:5173',
  secret: 'a'.repeat(64),
  secure: false,
  ttlSeconds: 3600,
};
const messages: AuthMail[] = [];
const auth = createAuthService(db, config, {
  enabled: true,
  async send(mail) {
    messages.push(mail);
  },
});
const users: string[] = [];
const keys: string[] = [];
const password = 'correct horse battery staple';
const status = (expected: number) => (error: unknown) =>
  error instanceof HttpError && error.status === expected;
async function account() {
  const result = await auth.register(
    {
      email: `${randomUUID()}@example.test`,
      displayName: 'Synthetic auth test',
      password,
    },
    undefined,
  );
  users.push(result.user.id);
  return result;
}
function latestToken(email: string) {
  const mail = messages.filter((message) => message.to === email).at(-1);
  const token = mail?.text.match(/#token=([a-f0-9]{64})/)?.[1];
  assert.ok(token);
  return token;
}
before(async () => {
  await db.$connect();
});
after(async () => {
  try {
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.authRateLimit.deleteMany({ where: { key: { in: keys } } });
  } finally {
    await db.$disconnect();
  }
});

test('registration, wrong credentials, rotation, expiry and logout persist securely', async () => {
  const first = await account();
  const row = await db.user.findUniqueOrThrow({ where: { id: first.user.id } });
  assert.ok(row.passwordHash.startsWith('scrypt$'));
  assert.notEqual(row.passwordHash, password);
  const stored = await db.session.findUniqueOrThrow({
    where: { tokenHash: digest(first.token) },
  });
  assert.notEqual(stored.tokenHash, first.token);
  assert.equal(stored.userId, first.user.id);
  await assert.rejects(
    () =>
      auth.register(
        { email: row.email, displayName: 'Duplicate', password },
        undefined,
      ),
    status(409),
  );
  await assert.rejects(
    () =>
      auth.login(
        { email: row.email, password: 'incorrect password' },
        undefined,
      ),
    status(401),
  );
  await assert.rejects(
    () =>
      auth.login(
        { email: `${randomUUID()}@example.test`, password },
        undefined,
      ),
    status(401),
  );
  const second = await auth.login({ email: row.email, password }, first.token);
  assert.notEqual(first.token, second.token);
  await assert.rejects(() => auth.me(first.token), status(401));
  assert.equal((await auth.me(second.token)).id, row.id);
  await db.session.update({
    where: { tokenHash: digest(second.token) },
    data: { expiresAt: new Date(0) },
  });
  await assert.rejects(() => auth.me(second.token), status(401));
  const third = await auth.login({ email: row.email, password }, undefined);
  await auth.logout(third.token);
  await assert.rejects(() => auth.me(third.token), status(401));
});

test('sessions are owner-scoped and can be revoked individually', async () => {
  const first = await account();
  const other = await account();
  const second = await auth.login(
    { email: first.user.email, password },
    undefined,
  );
  const list = await auth.sessions(first.token);
  assert.equal(list.length, 2);
  const current = list.find((session) => session.current);
  assert.ok(current);
  await assert.rejects(() => auth.revoke(other.token, current.id), status(404));
  assert.equal(await auth.revoke(first.token, current.id), true);
  await assert.rejects(() => auth.me(first.token), status(401));
  assert.equal((await auth.me(second.token)).id, first.user.id);
});

test('verification and reset tokens are hashed, expiring, single-use, and reset revokes sessions', async () => {
  const accountResult = await account();
  await auth.resend(accountResult.token);
  const verify = latestToken(accountResult.user.email);
  const stored = await db.authToken.findUniqueOrThrow({
    where: { tokenHash: digest(verify) },
  });
  assert.notEqual(stored.tokenHash, verify);
  await auth.verify(verify);
  assert.equal((await auth.me(accountResult.token)).emailVerified, true);
  await assert.rejects(() => auth.verify(verify), status(400));
  await auth.requestReset(accountResult.user.email);
  const expired = latestToken(accountResult.user.email);
  await db.authToken.update({
    where: { tokenHash: digest(expired) },
    data: { expiresAt: new Date(0) },
  });
  await assert.rejects(
    () => auth.reset({ token: expired, password: 'another strong password' }),
    status(400),
  );
  await auth.requestReset(`${randomUUID()}@example.test`); // Same successful public outcome.
  await auth.requestReset(accountResult.user.email);
  const reset = latestToken(accountResult.user.email);
  const attempts = await Promise.allSettled([
    auth.reset({ token: reset, password: 'another strong password' }),
    auth.reset({ token: reset, password: 'another strong password' }),
  ]);
  assert.equal(
    attempts.filter((attempt) => attempt.status === 'fulfilled').length,
    1,
  );
  for (const attempt of attempts)
    if (attempt.status === 'rejected') assert.ok(status(400)(attempt.reason));
  await assert.rejects(() => auth.me(accountResult.token), status(401));
  await assert.rejects(
    () => auth.login({ email: accountResult.user.email, password }, undefined),
    status(401),
  );
  assert.ok(
    (
      await auth.login(
        {
          email: accountResult.user.email,
          password: 'another strong password',
        },
        undefined,
      )
    ).user.id,
  );
});

test('rate limits survive service recreation and concurrent increments', async () => {
  const key = digest(randomUUID());
  keys.push(key);
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () => auth.limit(key, 3, 60 * 60_000)),
  );
  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    3,
  );
  const restarted = createAuthService(db, config, {
    enabled: false,
    async send() {},
  });
  await assert.rejects(() => restarted.limit(key, 3, 60 * 60_000), status(429));
});
