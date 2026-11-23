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
