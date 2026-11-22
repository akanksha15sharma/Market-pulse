import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { loginSchema, registerSchema } from '@marketpulse/contracts';
import { createApp } from '../../src/app.js';
import type { AuthConfig } from '../../src/config/env.js';
import type { AuthService } from '../../src/modules/auth/service.js';
import { HttpError } from '../../src/lib/http-error.js';
import {
  digest,
  hashPassword,
  newToken,
  verifyPassword,
} from '../../src/modules/auth/security.js';
import { cookieJar, request } from '../helpers/http.js';

const config: AuthConfig = {
  origin: 'http://localhost:5173',
  secret: 'a'.repeat(64),
  secure: false,
  ttlSeconds: 3600,
};
function fixture(overrides: Partial<AuthService> = {}, settings = config) {
  const user = {
    id: randomUUID(),
    email: 'user@example.test',
    displayName: 'Test User',
    emailVerified: false,
  };
  const token = newToken();
  const auth: AuthService = {
    limit: async () => {},
    register: async () => ({ user, token }),
    login: async ({ password }) => {
      if (password !== 'correct passphrase')
        throw new HttpError(401, 'Invalid email or password');
      return { user, token };
    },
    me: async (raw) => {
      if (raw !== token) throw new HttpError(401, 'Sign in to continue');
      return user;
    },
    logout: async () => {},
    sessions: async () => [],
    revoke: async () => false,
    requestReset: async () => {},
    resend: async () => {},
    verify: async () => {},
    reset: async () => {},
    ...overrides,
  };
  return { app: createApp(auth, settings), user, token };
}

test('password hashes are salted, verify correctly, and do not accept malformed hashes', async () => {
  const password = 'my long passphrase 🔐';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.ok(!first.includes(password));
  assert.ok(await verifyPassword(password, first));
  assert.equal(await verifyPassword('incorrect passphrase', first), false);
  assert.equal(await verifyPassword(password, 'invalid'), false);
  assert.equal(digest(newToken()).length, 64);
});

test('validation normalizes email but preserves password; rejects weak and oversized input', () => {
  const input = {
    email: '  USER@EXAMPLE.TEST ',
    password: '  long passphrase  ',
    displayName: ' Name ',
  };
  const parsed = registerSchema.parse(input);
  assert.equal(parsed.email, 'user@example.test');
  assert.equal(parsed.password, input.password);
  assert.equal(
    registerSchema.safeParse({ ...input, password: 'short' }).success,
    false,
  );
  assert.equal(
    registerSchema.safeParse({ ...input, password: 'a'.repeat(129) }).success,
    false,
  );
  assert.equal(
    registerSchema.safeParse({ ...input, admin: true }).success,
    false,
  );
  assert.equal(
    loginSchema.safeParse({ email: 'bad', password: 'test' }).success,
    false,
  );
});

test('HTTP authentication sets secure session attributes, protects private data, rejects bad credentials', async () => {
  const { app, user } = fixture();
  const jar = cookieJar();
  assert.equal(
    (await request(app, 'GET', '/api/v1/private/profile')).status,
    401,
  );
  async function login(password: string) {
    const csrf = await request(app, 'GET', '/api/v1/auth/csrf', {
      cookie: jar.header(),
    });
    jar.update(csrf.headers);
    const result = await request(
      app,
      'POST',
      '/api/v1/auth/login',
      {
        cookie: jar.header(),
        origin: config.origin,
        'x-csrf-token': csrf.body.csrfToken as string,
      },
      { email: user.email, password },
    );
    jar.update(result.headers);
    return result;
  }
  assert.equal((await login('wrong passphrase')).status, 401);
  const result = await login('correct passphrase');
  assert.equal(result.status, 200);
  const cookies = result.headers['set-cookie'] as string[];
  assert.ok(
    cookies.some(
      (cookie) =>
        cookie.startsWith('mp_session=') &&
        cookie.includes('HttpOnly') &&
        cookie.includes('SameSite=Strict') &&
        cookie.includes('Path=/'),
    ),
  );
  assert.equal(result.body.token, undefined);
  assert.equal(JSON.stringify(result.body).includes('passwordHash'), false);
  assert.equal(
    (
      await request(app, 'GET', '/api/v1/private/profile', {
        cookie: jar.header(),
      })
    ).status,
    200,
  );
});

test('CSRF is required, origin must match, and tokens cannot be carried across session rotation', async () => {
  const { app, token } = fixture();
  const csrf = await request(app, 'GET', '/api/v1/auth/csrf');
  const jar = cookieJar();
  jar.update(csrf.headers);
  const body = { email: 'user@example.test', password: 'correct passphrase' };
  const original = csrf.body.csrfToken as string;
  const tampered = original.slice(0, -1) + (original.endsWith('0') ? '1' : '0');
  assert.equal(
    (
      await request(
        app,
        'POST',
        '/api/v1/auth/login',
        {
          origin: config.origin,
          cookie: `mp_csrf=${tampered}`,
          'x-csrf-token': tampered,
        },
        body,
      )
    ).status,
    403,
  );
  const clock = Date.now;
  try {
    Date.now = () => clock() + 31 * 60_000;
    assert.equal(
      (
        await request(
          app,
          'POST',
          '/api/v1/auth/login',
          {
            origin: config.origin,
            cookie: jar.header(),
            'x-csrf-token': original,
          },
          body,
        )
      ).status,
      403,
    );
  } finally {
    Date.now = clock;
  }

  assert.equal(
    (
      await request(
        app,
        'POST',
        '/api/v1/auth/login',
        { origin: config.origin },
        body,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        app,
        'POST',
        '/api/v1/auth/login',
        {
          origin: 'https://untrusted.example',
          cookie: jar.header(),
          'x-csrf-token': csrf.body.csrfToken as string,
        },
        body,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        app,
        'POST',
        '/api/v1/auth/login',
        {
          origin: config.origin,
          cookie: `${jar.header()}; mp_session=${token}`,
          'x-csrf-token': csrf.body.csrfToken as string,
        },
        body,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        app,
        'POST',
        '/api/v1/auth/login',
        { cookie: jar.header(), 'x-csrf-token': csrf.body.csrfToken as string },
        body,
      )
    ).status,
    403,
  );
});

test('HTTP validation, rate limiting, and internal failures return safe errors', async () => {
  for (const [override, expected] of [
    [{}, 400],
    [
      {
        limit: async () => {
          throw new HttpError(429, 'Too many attempts');
        },
      },
      429,
    ],
    [
      {
        limit: async () => {
          throw new Error('PRIVATE_DATABASE_URL');
        },
      },
      500,
    ],
  ] as const) {
    const { app } = fixture(override);
    const csrf = await request(app, 'GET', '/api/v1/auth/csrf');
    const jar = cookieJar();
    jar.update(csrf.headers);
    const result = await request(
      app,
      'POST',
      '/api/v1/auth/login',
      {
        origin: config.origin,
        cookie: jar.header(),
        'x-csrf-token': csrf.body.csrfToken as string,
      },
      { email: 'bad', password: '' },
    );
    assert.equal(result.status, expected);
    assert.ok(!JSON.stringify(result.body).includes('PRIVATE_DATABASE_URL'));
    if (expected === 429) assert.ok(result.headers['retry-after']);
  }
});

test('production cookies have the __Host prefix and Secure; auth responses are never cached', async () => {
  // Cookie issuance uses identical production flags for anonymous CSRF and sessions.
  const { app } = fixture({}, { ...config, secure: true });
  const response = await request(app, 'GET', '/api/v1/auth/csrf');
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.ok(
    (response.headers['set-cookie'] as string[]).some(
      (cookie) =>
        cookie.startsWith('__Host-mp_csrf=') &&
        cookie.includes('Secure') &&
        !cookie.includes('Domain='),
    ),
  );
  const jar = cookieJar();
  jar.update(response.headers);
  const signedIn = await request(
    app,
    'POST',
    '/api/v1/auth/login',
    {
      origin: config.origin,
      cookie: jar.header(),
      'x-csrf-token': response.body.csrfToken as string,
    },
    { email: 'user@example.test', password: 'correct passphrase' },
  );
  assert.equal(signedIn.status, 200);
  assert.ok(
    (signedIn.headers['set-cookie'] as string[]).some(
      (cookie) =>
        cookie.startsWith('__Host-mp_session=') &&
        cookie.includes('Secure') &&
        cookie.includes('HttpOnly') &&
        !cookie.includes('Domain='),
    ),
  );
});
