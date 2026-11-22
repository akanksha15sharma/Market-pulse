import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  watchlistInputSchema,
  watchlistItemInputSchema,
  type WatchlistView,
} from '@marketpulse/contracts';
import { createApp } from '../../src/app.js';
import type { AuthService } from '../../src/modules/auth/service.js';
import type { WatchlistService } from '../../src/modules/watchlists/service.js';
import { HttpError } from '../../src/lib/http-error.js';
import { cookieJar, request } from '../helpers/http.js';

const config = {
  origin: 'http://localhost:5173',
  secret: 'a'.repeat(64),
  secure: false,
  ttlSeconds: 3600,
};
const tokens = { owner: 'a'.repeat(64), other: 'b'.repeat(64) };
const asset = {
  id: randomUUID(),
  key: 'crypto:bitcoin',
  symbol: 'BTC',
  name: 'Bitcoin',
  type: 'CRYPTO' as const,
  exchange: null,
  quoteCurrency: 'USD' as const,
  isDemoOnly: false,
};
function fixture(options: { limited?: boolean; fail?: boolean } = {}) {
  const owner = randomUUID();
  const other = randomUUID();
  const records = new Map<string, { userId: string; list: WatchlistView }>();
  const unused = async () => {
    throw new Error('Unexpected auth call');
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
    async me(token: string | undefined) {
      if (token !== tokens.owner && token !== tokens.other)
        throw new HttpError(401, 'Session expired. Sign in again.');
      return {
        id: token === tokens.owner ? owner : other,
        displayName: 'Test',
        email: 'test@example.test',
        emailVerified: false,
      };
    },
    async limit() {
      if (options.limited) throw new HttpError(429, 'Too many attempts', 60);
    },
  };
  function owned(userId: string, id: string) {
    const entry = records.get(id);
    if (!entry || entry.userId !== userId)
      throw new HttpError(404, 'Watchlist not found');
    return entry.list;
  }
  const service: WatchlistService = {
    async list(userId) {
      if (options.fail) throw new Error('PRIVATE_DATABASE_URL');
      return [...records.values()]
        .filter((row) => row.userId === userId)
        .map((row) => row.list);
    },
    async get(userId, id) {
      return owned(userId, id);
    },
    async create(userId, input) {
      const list = {
        id: randomUUID(),
        name: watchlistInputSchema.parse(input).name,
        createdAt: new Date().toISOString(),
        items: [],
      };
      records.set(list.id, { userId, list });
      return list;
    },
    async rename(userId, id, input) {
      const list = owned(userId, id);
      list.name = watchlistInputSchema.parse(input).name;
      return list;
    },
    async delete(userId, id) {
      owned(userId, id);
      records.delete(id);
    },
    async add(userId, id, assetId) {
      const list = owned(userId, id);
      if (assetId !== asset.id) throw new HttpError(404, 'Asset not found');
      if (!list.items.length)
        list.items.push({
          asset,
          available: true,
          addedAt: new Date().toISOString(),
        });
      return list;
    },
    async remove(userId, id) {
      owned(userId, id).items = [];
    },
  };
  const app = createApp(auth, config, undefined, service);
  const read = (path = '/api/v1/watchlists', token = 'owner') =>
    request(app, 'GET', path, {
      cookie: `mp_session=${tokens[token as keyof typeof tokens] ?? token}`,
    });
  async function write(
    method: string,
    path: string,
    body?: unknown,
    token = 'owner',
  ) {
    const cookie = `mp_session=${tokens[token as keyof typeof tokens] ?? token}`;
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
  return { app, read, write };
}

test('watchlist contracts normalize names and reject empty, oversized, control and owner fields', () => {
  assert.equal(
    watchlistInputSchema.parse({ name: '  Long-term ideas  ' }).name,
    'Long-term ideas',
  );
  for (const name of ['', '   ', 'a'.repeat(101), 'line\nbreak'])
    assert.equal(watchlistInputSchema.safeParse({ name }).success, false);
  assert.equal(
    watchlistInputSchema.safeParse({ name: 'Valid', userId: randomUUID() })
      .success,
    false,
  );
  assert.equal(
    watchlistItemInputSchema.safeParse({ assetId: 'BTC' }).success,
    false,
  );
  assert.equal(
    watchlistItemInputSchema.safeParse({
      assetId: asset.id,
      userId: randomUUID(),
    }).success,
    false,
  );
});

test('all watchlist operations require a valid signed-in session', async () => {
  const { app } = fixture();
  const id = randomUUID();
  for (const [method, path, body] of [
    ['GET', '/api/v1/watchlists', undefined],
    ['GET', `/api/v1/watchlists/${id}`, undefined],
    ['POST', '/api/v1/watchlists', { name: 'Private' }],
    ['PATCH', `/api/v1/watchlists/${id}`, { name: 'New' }],
    ['DELETE', `/api/v1/watchlists/${id}`, undefined],
    ['POST', `/api/v1/watchlists/${id}/items`, { assetId: asset.id }],
    ['DELETE', `/api/v1/watchlists/${id}/items/${asset.id}`, undefined],
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
          { cookie: 'mp_session=expired', origin: config.origin },
          body,
        )
      ).status,
      401,
    );
  }
});

test('signed-in writes require session-bound CSRF and the configured origin', async () => {
  const { app } = fixture();
  const csrf = await request(app, 'GET', '/api/v1/auth/csrf', {
    cookie: `mp_session=${tokens.owner}`,
  });
  const jar = cookieJar();
  jar.update(csrf.headers);
  const body = { name: 'Private' };
  assert.equal(
    (
      await request(
        app,
        'POST',
        '/api/v1/watchlists',
        { cookie: `mp_session=${tokens.owner}`, origin: config.origin },
        body,
      )
    ).status,
    403,
  );
  const headers = {
    cookie: `mp_session=${tokens.owner}; ${jar.header()}`,
    'x-csrf-token': csrf.body.csrfToken as string,
  };
  assert.equal(
    (
      await request(
        app,
        'POST',
        '/api/v1/watchlists',
        { ...headers, origin: 'https://untrusted.example' },
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
        '/api/v1/watchlists',
        {
          ...headers,
          cookie: `mp_session=${tokens.other}; ${jar.header()}`,
          origin: config.origin,
        },
        body,
      )
    ).status,
    403,
  );
});

test('watchlist HTTP create, rename, add, remove, delete and empty state use the public contract', async () => {
  const { read, write } = fixture();
  assert.deepEqual((await read()).body.watchlists, []);
  const created = await write('POST', '/api/v1/watchlists', {
    name: '  Core ideas  ',
  });
  assert.equal(created.status, 201);
  const list = created.body.watchlist as WatchlistView;
  assert.equal(list.name, 'Core ideas');
  assert.equal('userId' in list, false);
  const path = `/api/v1/watchlists/${list.id}`;
  assert.equal((await read(path)).headers['cache-control'], 'no-store');
  assert.equal((await write('PATCH', path, { name: 'Renamed' })).status, 200);
  for (let attempt = 0; attempt < 2; attempt++)
    assert.equal(
      (await write('POST', `${path}/items`, { assetId: asset.id })).status,
      200,
    );
  assert.equal(
    ((await read(path)).body.watchlist as WatchlistView).items.length,
    1,
  );
  assert.equal(
    (await write('DELETE', `${path}/items/${asset.id}`)).status,
    204,
  );
  assert.equal(
    ((await read(path)).body.watchlist as WatchlistView).items.length,
    0,
  );
  assert.equal((await write('DELETE', path)).status, 204);
  assert.equal((await read(path)).status, 404);
});

test('another account cannot read, rename, delete or mutate a private watchlist', async () => {
  const { read, write } = fixture();
  const created = await write('POST', '/api/v1/watchlists', {
    name: 'Private name',
  });
  const path = `/api/v1/watchlists/${(created.body.watchlist as WatchlistView).id}`;
  assert.deepEqual(
    (await read('/api/v1/watchlists', 'other')).body.watchlists,
    [],
  );
  assert.equal((await read(path, 'other')).status, 404);
  for (const [method, url, body] of [
    ['PATCH', path, { name: 'Stolen' }],
    ['DELETE', path, undefined],
    ['POST', `${path}/items`, { assetId: asset.id }],
    ['DELETE', `${path}/items/${asset.id}`, undefined],
  ] as const) {
    const result = await write(method, url, body, 'other');
    assert.equal(result.status, 404);
    assert.ok(!JSON.stringify(result.body).includes('Private name'));
  }
  assert.equal(
    ((await read(path)).body.watchlist as WatchlistView).name,
    'Private name',
  );
});

test('watchlist routing rejects malformed IDs, extra fields and query ownership overrides', async () => {
  const { read, write } = fixture();
  assert.equal((await read('/api/v1/watchlists/not-a-uuid')).status, 400);
  assert.equal(
    (await read(`/api/v1/watchlists?userId=${randomUUID()}`)).status,
    400,
  );
  assert.equal(
    (
      await write('POST', '/api/v1/watchlists', {
        name: 'Private',
        userId: randomUUID(),
      })
    ).status,
    400,
  );
  const created = await write('POST', '/api/v1/watchlists', { name: 'Valid' });
  const path = `/api/v1/watchlists/${(created.body.watchlist as WatchlistView).id}`;
  assert.equal(
    (
      await write('POST', `${path}/items`, {
        assetId: asset.id,
        provider: 'REAL',
      })
    ).status,
    400,
  );
  assert.equal(
    (await write('POST', `${path}/items`, { assetId: randomUUID() })).status,
    404,
  );
});

test('watchlist rate limits and internal failures return safe uncached errors', async () => {
  const limited = await fixture({ limited: true }).read();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['retry-after'], '60');
  assert.equal(limited.headers['cache-control'], 'no-store');
  const failed = await fixture({ fail: true }).read();
  assert.equal(failed.status, 500);
  assert.ok(!JSON.stringify(failed.body).includes('PRIVATE_DATABASE_URL'));
});
