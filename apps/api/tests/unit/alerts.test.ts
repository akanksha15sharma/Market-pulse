import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  alertCreateSchema,
  alertThresholdSchema,
  type AlertView,
} from '@marketpulse/contracts';
import { Prisma } from '../../src/generated/prisma/client.js';
import {
  canTrigger,
  type EvaluationAlert,
} from '../../src/modules/alerts/evaluation.js';
import type { CachedQuote } from '../../src/modules/markets/types.js';
import { createApp } from '../../src/app.js';
import type { AlertService } from '../../src/modules/alerts/service.js';
import type { AuthService } from '../../src/modules/auth/service.js';
import { HttpError } from '../../src/lib/http-error.js';
import { cookieJar, request } from '../helpers/http.js';
const NOW = Date.parse('2026-11-23T12:00:00Z');
const assetId = randomUUID();
const candidate: EvaluationAlert = {
  assetId,
  provider: 'COINPAPRIKA',
  mode: 'REAL',
  status: 'ACTIVE',
  armedAt: new Date(NOW - 60_000),
  direction: 'ABOVE',
  threshold: new Prisma.Decimal('100'),
  asset: { type: 'CRYPTO', isActive: true, isDemoOnly: false },
};
const quote: CachedQuote = {
  assetId,
  provider: 'COINPAPRIKA',
  mode: 'REAL',
  price: '100',
  changePercent: null,
  sourceAt: NOW - 1000,
  fetchedAt: NOW - 500,
};
const config = {
  origin: 'http://localhost:5173',
  secret: 'a'.repeat(64),
  secure: false,
  ttlSeconds: 3600,
};

test('target prices require exact positive decimals within PostgreSQL numeric precision', () => {
  for (const value of [
    '0',
    '-1',
    'NaN',
    'Infinity',
    '1e3',
    '0.0000000000000000001',
    '100000000000000000000',
    '1.2.3',
    '',
  ])
    assert.equal(alertThresholdSchema.safeParse(value).success, false, value);
  for (const value of [
    '1',
    '0.000000000000000001',
    '99999999999999999999.999999999999999999',
  ])
    assert.equal(alertThresholdSchema.safeParse(value).success, true);
  assert.equal(alertThresholdSchema.parse(' 1.25 '), '1.25');
  assert.equal(
    alertCreateSchema.safeParse({
      assetId,
      direction: 'ABOVE',
      threshold: '1',
      userId: randomUUID(),
    }).success,
    false,
  );
  assert.equal(
    alertCreateSchema.safeParse({
      assetId,
      direction: 'ABOVE',
      threshold: '1',
      currentPrice: '2',
      mode: 'REAL',
    }).success,
    false,
  );
});

test('inclusive thresholds use exact decimals, including amounts beyond JavaScript number precision', () => {
  assert.equal(canTrigger(candidate, quote, NOW), true);
  assert.equal(
    canTrigger({ ...candidate, direction: 'BELOW' }, quote, NOW),
    true,
  );
  assert.equal(
    canTrigger(candidate, { ...quote, price: '99.999999999999999999' }, NOW),
    false,
  );
  assert.equal(
    canTrigger(
      { ...candidate, direction: 'BELOW' },
      { ...quote, price: '100.000000000000000001' },
      NOW,
    ),
    false,
  );
  const precise = {
    ...candidate,
    threshold: new Prisma.Decimal('99999999999999999999.000000000000000002'),
  };
  assert.equal(
    canTrigger(
      precise,
      { ...quote, price: '99999999999999999999.000000000000000001' },
      NOW,
    ),
    false,
  );
});

test('simulated, stock, inactive, unsupported, paused and already-triggered observations never qualify', () => {
  for (const alteration of [
    { provider: 'DEMO' as const, mode: 'DEMO' as const },
    { mode: 'DEMO' as const },
  ])
    assert.equal(
      canTrigger(candidate, { ...quote, ...alteration }, NOW),
      false,
    );
  for (const alteration of [
    { status: 'PAUSED' as const },
    { status: 'TRIGGERED' as const },
    { provider: 'DEMO' as const },
    { provider: 'COINGECKO' as const },
    { mode: 'DEMO' as const },
    { assetId: randomUUID() },
    { asset: { ...candidate.asset, type: 'STOCK' as const } },
    { asset: { ...candidate.asset, isDemoOnly: true } },
    { asset: { ...candidate.asset, isActive: false } },
  ])
    assert.equal(
      canTrigger({ ...candidate, ...alteration }, quote, NOW),
      false,
    );
});

test('stale, future, invalid-time, pre-arm and invalid-price observations never qualify', () => {
  for (const alteration of [
    { sourceAt: NOW - 20 * 60_000 - 1 },
    { fetchedAt: NOW - 20 * 60_000 - 1 },
    { sourceAt: NOW + 1 },
    { fetchedAt: NOW + 1 },
    { sourceAt: candidate.armedAt.getTime() },
    { fetchedAt: candidate.armedAt.getTime() },
    { sourceAt: NaN },
    { fetchedAt: Infinity },
    { price: '0' },
    { price: '-1' },
    { price: 'Infinity' },
    { price: 'invalid' },
  ])
    assert.equal(
      canTrigger(candidate, { ...quote, ...alteration }, NOW),
      false,
      JSON.stringify(alteration),
    );
  assert.equal(
    canTrigger({ ...candidate, armedAt: new Date('invalid') }, quote, NOW),
    false,
  );
  assert.equal(
    canTrigger(
      candidate,
      { ...quote, sourceAt: NOW - 100, fetchedAt: NOW - 500 },
      NOW,
    ),
    false,
  );
});

function fixture(options: { limited?: boolean; fail?: boolean } = {}) {
  const owner = randomUUID();
  const stranger = randomUUID();
  const token = 'a'.repeat(64);
  const otherToken = 'b'.repeat(64);
  const records = new Map<string, { userId: string; alert: AlertView }>();
  const unused = async () => {
    throw new Error('Unexpected authentication operation');
  };
  const auth: AuthService = {
    register: unused,
    login: unused,
    logout: unused,
    sessions: unused,
    revoke: unused,
    requestReset: unused,
    resend: unused,
    verify: unused,
    reset: unused,
    async me(raw) {
      if (raw !== token && raw !== otherToken)
        throw new HttpError(401, 'Sign in');
      return {
        id: raw === token ? owner : stranger,
        email: 'test@example.test',
        displayName: 'Test',
        emailVerified: false,
      };
    },
    async limit() {
      if (options.limited) throw new HttpError(429, 'Too many attempts', 60);
    },
  };
  function owned(userId: string, id: string) {
    const row = records.get(id);
    if (!row || row.userId !== userId)
      throw new HttpError(404, 'Alert not found');
    return row.alert;
  }
  const service: AlertService = {
    async list(userId, query) {
      if (options.fail) throw new Error('PRIVATE_DATABASE_URL');
      const alerts = [...records.values()]
        .filter((row) => row.userId === userId)
        .map((row) => row.alert);
      return {
        alerts,
        activeCount: alerts.filter((alert) => alert.status === 'ACTIVE').length,
        total: alerts.length,
        page: query.page,
        limit: query.limit,
      };
    },
    async get(userId, id) {
      return owned(userId, id);
    },
    async events(userId, id, query) {
      owned(userId, id);
      return { events: [], total: 0, ...query };
    },
    async create(userId, input) {
      const target = alertCreateSchema.parse(input);
      const alert: AlertView = {
        ...target,
        id: randomUUID(),
        asset: {
          id: target.assetId,
          key: 'crypto:bitcoin',
          type: 'CRYPTO',
          symbol: 'BTC',
          name: 'Bitcoin',
          exchange: null,
          quoteCurrency: 'USD',
          isDemoOnly: false,
        },
        provider: 'COINPAPRIKA',
        mode: 'REAL',
        currency: 'USD',
        status: 'ACTIVE',
        activation: 1,
        armedAt: new Date(NOW).toISOString(),
        createdAt: new Date(NOW).toISOString(),
        eligibility: 'eligible',
        latestEvent: null,
      };
      records.set(alert.id, { userId, alert });
      return alert;
    },
    async edit(userId, id) {
      const alert = owned(userId, id);
      alert.status = 'PAUSED';
      return alert;
    },
    async pause(userId, id) {
      const alert = owned(userId, id);
      alert.status = 'PAUSED';
      return alert;
    },
    async rearm(userId, id) {
      const alert = owned(userId, id);
      alert.status = 'ACTIVE';
      alert.activation++;
      return alert;
    },
    async delete(userId, id) {
      owned(userId, id);
      records.delete(id);
    },
  };
  const app = createApp(auth, config, undefined, undefined, service);
  async function call(
    method: string,
    path: string,
    body?: unknown,
    other = false,
  ) {
    const cookie = `mp_session=${other ? otherToken : token}`;
    const csrf = await request(app, 'GET', '/api/v1/auth/csrf', { cookie });
    const jar = cookieJar();
    jar.update(csrf.headers);
    return request(
      app,
      method,
      path,
      {
        cookie: `${cookie}; ${jar.header()}`,
        origin: config.origin,
        'x-csrf-token': csrf.body.csrfToken as string,
      },
      body,
    );
  }
  return { app, call, token };
}

test('HTTP alert management uses authenticated owner scope and returns uncached public records', async () => {
  const { call } = fixture();
  const created = await call('POST', '/api/v1/alerts', {
    assetId,
    direction: 'ABOVE',
    threshold: '100',
  });
  assert.equal(created.status, 201);
  const alert = created.body.alert as AlertView;
  const path = `/api/v1/alerts/${alert.id}`;
  assert.equal('userId' in alert, false);
  assert.equal((await call('GET', path)).headers['cache-control'], 'no-store');
  assert.equal((await call('GET', `${path}/events`)).status, 200);
  for (const [method, url, body] of [
    ['GET', path, undefined],
    ['GET', `${path}/events`, undefined],
    ['PATCH', path, { direction: 'BELOW', threshold: '90' }],
    ['POST', `${path}/pause`, undefined],
    ['POST', `${path}/rearm`, undefined],
    ['DELETE', path, undefined],
  ] as const)
    assert.equal((await call(method, url, body, true)).status, 404);
  assert.deepEqual(
    (await call('GET', '/api/v1/alerts', undefined, true)).body.alerts,
    [],
  );
  assert.equal((await call('POST', `${path}/pause`)).status, 200);
  assert.equal((await call('POST', `${path}/rearm`)).status, 200);
  assert.equal(
    (await call('PATCH', path, { direction: 'BELOW', threshold: '90' })).status,
    200,
  );
  assert.equal((await call('DELETE', path)).status, 204);
  assert.equal((await call('GET', path)).status, 404);
});

test('HTTP alert writes require a valid session, matching origin and session-bound CSRF', async () => {
  const { app, token } = fixture();
  const input = { assetId, direction: 'ABOVE', threshold: '100' };
  assert.equal((await request(app, 'GET', '/api/v1/alerts')).status, 401);
  assert.equal(
    (
      await request(
        app,
        'POST',
        '/api/v1/alerts',
        { origin: config.origin },
        input,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await request(
        app,
        'POST',
        '/api/v1/alerts',
        { origin: config.origin, cookie: `mp_session=${token}` },
        input,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(
        app,
        'POST',
        '/api/v1/alerts',
        { origin: 'https://untrusted.example', cookie: `mp_session=${token}` },
        input,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request(app, 'GET', '/api/v1/alerts', {
        cookie: `mp_session=${'c'.repeat(64)}`,
      })
    ).status,
    401,
  );
  const csrf = await request(app, 'GET', '/api/v1/auth/csrf', {
    cookie: `mp_session=${token}`,
  });
  const jar = cookieJar();
  jar.update(csrf.headers);
  assert.equal(
    (
      await request(
        app,
        'POST',
        '/api/v1/alerts',
        {
          origin: config.origin,
          cookie: `mp_session=${'b'.repeat(64)}; ${jar.header()}`,
          'x-csrf-token': csrf.body.csrfToken as string,
        },
        input,
      )
    ).status,
    403,
  );
});

test('alert routing rejects malformed IDs, ownership/source spoofing and invalid pagination', async () => {
  const { call } = fixture();
  assert.equal((await call('GET', '/api/v1/alerts/not-a-uuid')).status, 400);
  assert.equal((await call('GET', '/api/v1/alerts?page=0')).status, 400);
  assert.equal(
    (await call('GET', `/api/v1/alerts?userId=${randomUUID()}`)).status,
    400,
  );
  assert.equal(
    (
      await call('POST', '/api/v1/alerts', {
        assetId,
        direction: 'ABOVE',
        threshold: '1',
        provider: 'COINPAPRIKA',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call('POST', '/api/v1/alerts', {
        assetId,
        direction: 'ABOVE',
        threshold: '0',
      })
    ).status,
    400,
  );
});

test('alert rate limits and internal failures are safe uncached errors', async () => {
  const limited = await fixture({ limited: true }).call(
    'GET',
    '/api/v1/alerts',
  );
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['retry-after'], '60');
  const failed = await fixture({ fail: true }).call('GET', '/api/v1/alerts');
  assert.equal(failed.status, 500);
  assert.ok(!JSON.stringify(failed.body).includes('PRIVATE_DATABASE_URL'));
});
