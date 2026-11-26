import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createNotificationCursor } from '../../src/modules/notifications/cursor.js';
import { createApp } from '../../src/app.js';
import type { AuthService } from '../../src/modules/auth/service.js';
import type { NotificationService } from '../../src/modules/notifications/service.js';
import { HttpError } from '../../src/lib/http-error.js';
import { cookieJar, request } from '../helpers/http.js';

const config = {
  origin: 'http://localhost:5173',
  secret: 'a'.repeat(64),
  secure: false,
  ttlSeconds: 3600,
};
const token = 'c'.repeat(64);
const owner = randomUUID();
function fixture(options: { limited?: boolean; fail?: boolean } = {}) {
  const calls: string[] = [];
  const auth = {
    async me(raw: string | undefined) {
      if (raw !== token) throw new HttpError(401, 'Sign in to continue');
      return { id: owner };
    },
    async limit(key: string, maximum: number, window: number) {
      assert.equal(maximum, 60);
      assert.equal(window, 60_000);
      assert.match(key, /^[a-f0-9]{64}$/);
      if (options.limited) throw new HttpError(429, 'Too many attempts', 60);
    },
  } as AuthService;
  const result = async (userId: string) => {
    assert.equal(userId, owner);
    calls.push(userId);
    if (options.fail) throw new Error('postgresql://PRIVATE_PASSWORD@internal');
    return { enabled: true as const, unreadCount: 0 };
  };
  const service = {
    history: result,
    summary: result,
    preferences: result,
    patchPreferences: result,
    setRead: result,
    markAllRead: result,
  } as unknown as NotificationService;
  const app = createApp(auth, config, undefined, undefined, undefined, {
    notifications: service,
  });
  return { app, calls };
}
async function headers(app: ReturnType<typeof createApp>) {
  const cookie = `mp_session=${token}`;
  const response = await request(app, 'GET', '/api/v1/auth/csrf', { cookie });
  const jar = cookieJar();
  jar.update(response.headers);
  return {
    cookie: `${cookie}; ${jar.header()}`,
    origin: config.origin,
    'x-csrf-token': response.body.csrfToken as string,
  };
}
const paths = [
  '/api/v1/notifications',
  '/api/v1/notifications/summary',
  '/api/v1/notifications/preferences',
];
test('every notification endpoint authenticates before using the service and never caches private responses', async () => {
  const { app, calls } = fixture();
  for (const path of paths) {
    assert.equal((await request(app, 'GET', path)).status, 401);
    const response = await request(app, 'GET', path, {
      cookie: `mp_session=${token}`,
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  for (const [method, path, body] of [
    [
      'PATCH',
      '/api/v1/notifications/preferences',
      { accountActivityEnabled: false },
    ],
    ['PATCH', `/api/v1/notifications/${randomUUID()}/read`, { read: true }],
    ['POST', '/api/v1/notifications/read-all', {}],
  ] as const) {
    assert.equal(
      (await request(app, method, path, { origin: config.origin }, body))
        .status,
      401,
    );
    assert.equal(
      (
        await request(
          app,
          method,
          path,
          { origin: config.origin, cookie: `mp_session=${token}` },
          body,
        )
      ).status,
      403,
    );
    assert.equal(
      (await request(app, method, path, await headers(app), body)).status,
      200,
    );
  }
  assert.equal(calls.length, 6);
});
test('foreign origins, invalid CSRF, strict queries and bodies cannot reach the service', async () => {
  const { app, calls } = fixture();
  const valid = await headers(app);
  assert.equal(
    (
      await request(app, 'GET', paths[0]!, {
        ...valid,
        origin: 'https://evil.example',
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request(app, 'GET', paths[0]!, {
        ...valid,
        'sec-fetch-site': 'cross-site',
      })
    ).status,
    403,
  );
  for (const path of [
    '?userId=' + owner,
    '?limit=51',
    '?limit=2&limit=3',
    '?filter=anything',
    '?cursor=',
    '/summary?limit=1',
    '/preferences?userId=' + owner,
  ])
    assert.equal(
      (await request(app, 'GET', paths[0]! + path, valid)).status,
      400,
    );
  for (const [path, body] of [
    ['/preferences', {}],
    ['/preferences', { securityNotificationsRequired: false }],
    ['/preferences', { emailAlertsEnabled: true }],
    ['/preferences', { accountActivityEnabled: 'false' }],
    [`/${randomUUID()}/read`, { read: true, userId: owner }],
    ['/invalid/read', { read: true }],
    [`/${randomUUID()}/read`, { read: 1 }],
  ] as const)
    assert.equal(
      (await request(app, 'PATCH', paths[0]! + path, valid, body)).status,
      400,
    );
  assert.equal(
    (
      await request(app, 'POST', paths[0] + '/read-all', valid, {
        userId: owner,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        app,
        'POST',
        paths[0] + '/read-all',
        { ...valid, 'x-csrf-token': 'invalid' },
        {},
      )
    ).status,
    403,
  );
  assert.equal(
    (await request(app, 'POST', paths[0]!, valid, { message: 'invented' }))
      .status,
    404,
  );
  assert.equal(calls.length, 0);
});
test('rate limits include Retry-After and unexpected failures never disclose database errors', async () => {
  const limited = fixture({ limited: true });
  const response = await request(limited.app, 'GET', paths[0]!, {
    cookie: `mp_session=${token}`,
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers['retry-after'], '60');
  assert.equal(limited.calls.length, 0);
  const broken = fixture({ fail: true });
  const failure = await request(broken.app, 'GET', paths[0]!, {
    cookie: `mp_session=${token}`,
  });
  assert.equal(failure.status, 500);
  assert.equal(failure.body.error, 'Request failed');
  assert.ok(!JSON.stringify(failure.body).includes('PRIVATE_PASSWORD'));
});
test('signed keyset cursors reject tampering, other accounts/filters, invalid payloads and rotated secrets', () => {
  const cursor = createNotificationCursor(config.secret);
  const position = {
    id: randomUUID(),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const encoded = cursor.encode(owner, 'all', position);
  assert.ok(encoded.length <= 256);
  assert.deepEqual(cursor.decode(encoded, owner, 'all'), position);
  for (const operation of [
    () => cursor.decode(encoded, randomUUID(), 'all'),
    () => cursor.decode(encoded, owner, 'unread'),
    () => cursor.decode('x' + encoded, owner, 'all'),
    () => cursor.decode(encoded + 'x', owner, 'all'),
    () => cursor.decode('invalid', owner, 'all'),
    () =>
      createNotificationCursor('different-secret').decode(
        encoded,
        owner,
        'all',
      ),
  ])
    assert.throws(
      operation,
      (error) => error instanceof HttpError && error.status === 400,
    );
});
