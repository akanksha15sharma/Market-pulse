import { AppLayout } from '../src/layouts/AppLayout';
import { api, ApiError } from '../src/lib/api-client';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { AuthForm } from '../src/features/auth/AuthForm';
import { accountLoader } from '../src/features/auth/loaders';

test('auth UI labels fields, supports password managers and separates login from registration', () => {
  const login = renderToStaticMarkup(
    <MemoryRouter>
      <AuthForm mode="login" />
    </MemoryRouter>,
  );
  const register = renderToStaticMarkup(
    <MemoryRouter>
      <AuthForm mode="register" />
    </MemoryRouter>,
  );
  assert.ok(login.includes('autoComplete="current-password"'));
  assert.ok(login.includes('Forgot password?'));
  assert.ok(!login.includes('Display name'));
  assert.ok(register.includes('autoComplete="new-password"'));
  assert.ok(register.includes('Display name'));
  assert.ok(register.includes('minLength="12"'));
});

test('account loader redirects only unauthenticated users and surfaces server failures', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: 'Sign in' }), { status: 401 });
    await assert.rejects(
      accountLoader,
      (error: unknown) =>
        error instanceof Response &&
        error.status === 302 &&
        error.headers.get('Location') === '/login',
    );
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: 'Request failed' }), {
        status: 500,
      });
    await assert.rejects(accountLoader, /Request failed/);
  } finally {
    globalThis.fetch = original;
  }
});

test('API client rejects malformed success bodies and preserves error status for redirects', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [200, 401, 500]) {
      globalThis.fetch = async () =>
        new Response('<html>Proxy error</html>', { status });
      await assert.rejects(
        () => api('/auth/me'),
        (error: unknown) =>
          error instanceof ApiError &&
          error.status === (status === 200 ? 502 : status) &&
          error.message === 'Unexpected server response. Try again.',
      );
    }
    for (const body of [
      null,
      { error: {} },
      { error: '' },
      { error: ['bad'] },
    ]) {
      globalThis.fetch = async () =>
        new Response(JSON.stringify(body), { status: 503 });
      await assert.rejects(
        () => api('/auth/me'),
        (error: unknown) =>
          error instanceof ApiError &&
          error.status === 503 &&
          error.message === 'Request failed. Try again.',
      );
    }
    globalThis.fetch = async () => new Response(null, { status: 204 });
    assert.equal(await api('/auth/me'), undefined);
  } finally {
    globalThis.fetch = original;
  }
});

test('invalid CSRF responses prevent mutations and show a recoverable error', async () => {
  const original = globalThis.fetch;
  try {
    for (const body of [
      '{',
      'null',
      '{}',
      '{"csrfToken":42}',
      '{"csrfToken":" "}',
    ]) {
      const paths: string[] = [];
      globalThis.fetch = async (path) => {
        paths.push(String(path));
        return new Response(body);
      };
      await assert.rejects(
        () => api('/auth/login', { method: 'POST' }),
        (error: unknown) =>
          error instanceof ApiError &&
          error.message === 'Could not secure the request. Try again.',
      );
      assert.deepEqual(paths, ['/api/v1/auth/csrf']);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test('API client sends valid secured mutations and reports network failures', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (path, options) => {
      if (String(path).endsWith('/csrf'))
        return new Response('{"csrfToken":"token"}');
      assert.equal(options?.method, 'POST');
      assert.equal(options?.credentials, 'same-origin');
      assert.equal(options?.cache, 'no-store');
      assert.equal(new Headers(options?.headers).get('X-CSRF-Token'), 'token');
      assert.equal(options?.body, '{"email":"user@example.com"}');
      return new Response('{"ok":true}');
    };
    assert.deepEqual(
      await api('/auth/login', {
        method: 'POST',
        body: { email: 'user@example.com' },
      }),
      { ok: true },
    );
    globalThis.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    await assert.rejects(() => api('/auth/me'), /Cannot reach MarketPulse/);
    await assert.rejects(
      () => api('/auth/login', { method: 'POST' }),
      /Cannot secure the request/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('skip link points to a focusable main landmark', () => {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <AppLayout />
    </MemoryRouter>,
  );
  assert.match(html, /href="#main"/);
  assert.match(html, /<main id="main" tabindex="-1"/);
  assert.match(html, /aria-label="Main navigation"/);
});

test('parallel secured writes keep each CSRF cookie/header pair together', async () => {
  const original = globalThis.fetch;
  let cookie = '',
    nonce = 0,
    active = 0,
    maximum = 0;
  try {
    globalThis.fetch = async (path, options) => {
      if (String(path).endsWith('/csrf')) {
        active++;
        maximum = Math.max(maximum, active);
        const token = `token-${++nonce}`;
        cookie = token;
        await new Promise((done) => setTimeout(done, 10));
        return new Response(JSON.stringify({ csrfToken: token }));
      }
      const valid =
        new Headers(options?.headers).get('X-CSRF-Token') === cookie;
      active--;
      return new Response(
        JSON.stringify(valid ? { ok: true } : { error: 'Invalid CSRF token' }),
        { status: valid ? 200 : 403 },
      );
    };
    const responses = await Promise.all([
      api('/notifications/read-all', { method: 'POST', body: {} }),
      api('/notifications/preferences', {
        method: 'PATCH',
        body: { accountActivityEnabled: false },
      }),
    ]);
    assert.deepEqual(responses, [{ ok: true }, { ok: true }]);
    assert.equal(maximum, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('failed writes release the CSRF queue without automatic replay and reads remain independent', async () => {
  const original = globalThis.fetch;
  const paths: string[] = [];
  try {
    globalThis.fetch = async (path) => {
      paths.push(String(path));
      if (String(path).endsWith('/csrf'))
        return new Response('{"csrfToken":"token"}');
      if (String(path).endsWith('/failed'))
        return new Response('{"error":"Denied"}', { status: 403 });
      return new Response('{"ok":true}');
    };
    const writes = await Promise.allSettled([
      api('/failed', { method: 'POST' }),
      api('/succeeded', { method: 'POST' }),
    ]);
    assert.equal(writes[0]!.status, 'rejected');
    assert.equal(writes[1]!.status, 'fulfilled');
    assert.equal(paths.filter((path) => path.endsWith('/failed')).length, 1);
    assert.equal(paths.filter((path) => path.endsWith('/csrf')).length, 2);
    assert.deepEqual(await api('/auth/me'), { ok: true });
  } finally {
    globalThis.fetch = original;
  }
});

test('browser origin lock covers the complete CSRF/write pair and session changes cancel queued writes', async () => {
  const original = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    'navigator',
  );
  const events = new EventTarget();
  let release!: () => void, started!: () => void;
  const acquired = new Promise<void>((done) => {
    started = done;
  });
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const paths: string[] = [];
  try {
    Object.defineProperty(globalThis, 'window', {
      value: events,
      configurable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        locks: {
          async request(name: string, callback: () => Promise<unknown>) {
            assert.equal(name, 'marketpulse-csrf-write');
            started();
            await gate;
            return callback();
          },
        },
      },
      configurable: true,
    });
    globalThis.fetch = async (path) => {
      paths.push(String(path));
      return new Response(
        String(path).endsWith('/csrf')
          ? '{"csrfToken":"token"}'
          : '{"ok":true}',
      );
    };
    const pending = api('/notifications/read-all', {
      method: 'POST',
      body: {},
    });
    await acquired;
    assert.deepEqual(paths, []);
    events.dispatchEvent(new Event('marketpulse-session-changed'));
    release();
    await assert.rejects(
      pending,
      (error) => error instanceof ApiError && error.status === 409,
    );
    assert.deepEqual(paths, []);
    assert.deepEqual(
      await api('/notifications/read-all', { method: 'POST', body: {} }),
      { ok: true },
    );
    assert.deepEqual(paths, [
      '/api/v1/auth/csrf',
      '/api/v1/notifications/read-all',
    ]);
  } finally {
    release();
    globalThis.fetch = original;
    for (const [name, descriptor] of [
      ['window', originalWindow],
      ['navigator', originalNavigator],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
