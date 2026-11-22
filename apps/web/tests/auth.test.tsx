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
