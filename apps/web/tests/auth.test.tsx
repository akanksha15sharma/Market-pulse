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

test('navbar shows only actions supported by the verified session state', async () => {
  const { SessionLinks } = await import('../src/features/auth/AuthNavigation');
  for (const status of [
    'loading',
    'guest',
    'authenticated',
    'error',
  ] as const) {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <SessionLinks
          status={status}
          busy={false}
          retry={() => {}}
          signOut={() => {}}
        />
      </MemoryRouter>,
    );
    assert.equal(html.includes('Sign in'), status === 'guest');
    assert.equal(html.includes('Sign out'), status === 'authenticated');
    assert.equal(html.includes('href="/account"'), status === 'authenticated');
    assert.equal(html.includes('Checking session'), status === 'loading');
    assert.equal(html.includes('Retry account status'), status === 'error');
  }
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <SessionLinks
        status="authenticated"
        busy
        retry={() => {}}
        signOut={() => {}}
      />
    </MemoryRouter>,
  );
  assert.match(html, /disabled=""/);
  assert.match(html, /Signing out/);
});

test('session navigation follows initial loading, sign-in, sign-out and expiry', async () => {
  const { createSessionStore } =
    await import('../src/features/auth/session-store');
  let signedIn = false;
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'user@example.test',
    displayName: 'Test',
    emailVerified: false,
  };
  const store = createSessionStore(async () => {
    if (!signedIn) throw new ApiError(401, 'Sign in');
    return { user };
  });
  const states: string[] = [];
  const unsubscribe = store.subscribe(() => {
    states.push(store.getSnapshot());
  });
  assert.equal(store.getSnapshot(), 'loading');
  await store.refresh();
  assert.equal(store.getSnapshot(), 'guest');
  signedIn = true;
  await store.refresh();
  assert.equal(store.getSnapshot(), 'authenticated');
  signedIn = false;
  await store.refresh();
  assert.equal(store.getSnapshot(), 'guest');
  signedIn = true;
  await store.refresh();
  store.expire();
  assert.equal(store.getSnapshot(), 'guest');
  assert.ok(states.includes('loading'));
  unsubscribe();
});

test('network/provider failures and malformed identity remain unknown, not signed out', async () => {
  const { createSessionStore } =
    await import('../src/features/auth/session-store');
  for (const failure of [
    new ApiError(0, 'Offline'),
    new ApiError(503, 'Unavailable'),
    { user: {} },
    undefined,
  ]) {
    const store = createSessionStore(async () => {
      if (failure instanceof Error) throw failure;
      return failure;
    });
    await store.refresh();
    assert.equal(store.getSnapshot(), 'error');
  }
});

test('late session responses cannot undo logout, expiry or a newer session check', async () => {
  const { createSessionStore } =
    await import('../src/features/auth/session-store');
  const user = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'user@example.test',
    displayName: 'Test',
    emailVerified: false,
  };
  for (const transition of ['expire', 'refresh', 'unmount'] as const) {
    let resolve!: (value: unknown) => void;
    let calls = 0;
    const store = createSessionStore(async () => {
      calls++;
      if (calls === 1)
        return new Promise((done) => {
          resolve = done;
        });
      throw new ApiError(401, 'Expired');
    });
    const pending = store.refresh();
    if (transition === 'expire') store.expire();
    else if (transition === 'refresh') await store.refresh();
    else store.cancel();
    resolve({ user });
    await pending;
    assert.equal(
      store.getSnapshot(),
      transition === 'unmount' ? 'loading' : 'guest',
    );
  }
});

test('protected API 401 signals session expiry while incorrect login does not', async () => {
  const { sessionExpiredEvent } = await import('../src/lib/api-events');
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const events = new EventTarget();
  let expired = 0;
  events.addEventListener(sessionExpiredEvent, () => {
    expired++;
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: events,
  });
  try {
    globalThis.fetch = async (url) =>
      String(url).endsWith('/csrf')
        ? new Response(JSON.stringify({ csrfToken: 'test-token' }))
        : new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
          });
    await assert.rejects(() => api('/auth/me'), /Unauthorized/);
    assert.equal(expired, 1);
    await assert.rejects(
      () => api('/auth/login', { method: 'POST', body: {} }),
      /Unauthorized/,
    );
    assert.equal(expired, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow)
      Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('shared auth validation keeps API payloads strict and passwords unchanged', async () => {
  const { validateAuthForm } =
    await import('../src/features/auth/form-validation');
  const password = '  private passphrase  ';
  const input = {
    email: '  USER@EXAMPLE.TEST ',
    displayName: '  User  ',
    password,
    confirmPassword: password,
  };
  const registration = validateAuthForm('register', input);
  assert.deepEqual(registration.errors, {});
  assert.deepEqual(registration.data, {
    email: 'user@example.test',
    displayName: 'User',
    password,
  });
  assert.deepEqual(validateAuthForm('login', input).data, {
    email: 'user@example.test',
    password,
  });
  assert.deepEqual(validateAuthForm('forgot', input).data, {
    email: 'user@example.test',
  });
  const token = 'a'.repeat(64);
  assert.deepEqual(validateAuthForm('reset', input, token).data, {
    token,
    password,
  });
  assert.ok(!JSON.stringify(registration.data).includes('confirmPassword'));
  assert.equal(
    validateAuthForm('register', { ...input, confirmPassword: 'different' })
      .data,
    undefined,
  );
  assert.match(
    validateAuthForm('reset', { ...input, confirmPassword: '' }, token).errors
      .confirmPassword!,
    /Confirm/,
  );
  assert.match(
    validateAuthForm('reset', input, 'malformed-private-token').errors.token!,
    /missing or invalid/,
  );
});

test('auth validation returns understandable field errors with existing length rules', async () => {
  const { validateAuthForm } =
    await import('../src/features/auth/form-validation');
  const invalid = validateAuthForm('register', {
    email: 'bad',
    displayName: ' ',
    password: 'short',
    confirmPassword: 'other',
  });
  assert.match(invalid.errors.email!, /valid email/);
  assert.match(invalid.errors.displayName!, /1–100/);
  assert.match(invalid.errors.password!, /12–128/);
  assert.match(invalid.errors.confirmPassword!, /do not match/);
  for (const size of [12, 128]) {
    const password = 'a'.repeat(size);
    assert.ok(
      validateAuthForm('register', {
        email: 'u@example.test',
        displayName: 'U',
        password,
        confirmPassword: password,
      }).data,
    );
  }
  assert.equal(
    validateAuthForm('login', {
      email: 'u@example.test',
      password: 'a'.repeat(129),
    }).data,
    undefined,
  );
  assert.ok(
    validateAuthForm('login', { email: 'u@example.test', password: 'a' }).data,
  );
});

test('auth errors explain network, rate limits and expiry without exposing internal details', async () => {
  const { authFailureMessage } =
    await import('../src/features/auth/form-validation');
  assert.match(
    authFailureMessage(new ApiError(0, 'private-token'), 'login'),
    /connection/,
  );
  assert.match(
    authFailureMessage(new ApiError(429, 'private-token'), 'forgot'),
    /Too many attempts/,
  );
  assert.equal(
    authFailureMessage(new ApiError(401, 'private-email'), 'login'),
    'Invalid email or password.',
  );
  assert.match(
    authFailureMessage(new ApiError(400, 'private-token'), 'reset'),
    /Invalid or expired/,
  );
  for (const error of [
    new Error('private-token'),
    new ApiError(503, 'private-token'),
    new ApiError(403, 'private-token'),
  ])
    assert.doesNotMatch(authFailureMessage(error, 'register'), /private-token/);
});

test('password controls have explicit non-submit buttons, manager support and linked errors', async () => {
  const { PasswordField } = await import('../src/features/auth/PasswordField');
  const html = renderToStaticMarkup(
    <PasswordField newPassword error="Use 12–128 characters." />,
  );
  assert.match(html, /type="password"/);
  assert.match(html, /autoComplete="new-password"/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-describedby="password-hint password-error"/);
  assert.match(html, /type="button"/);
  assert.match(html, /aria-label="Show password"/);
  assert.match(html, /aria-controls="password"/);
  const register = renderToStaticMarkup(
    <MemoryRouter>
      <AuthForm mode="register" />
    </MemoryRouter>,
  );
  assert.match(register, /name="confirmPassword"/);
  assert.match(register, /type="submit"/);
  assert.match(register, /noValidate=""/);
});

test('verification failures explain expired links without exposing server details', async () => {
  const { authFailureMessage } =
    await import('../src/features/auth/form-validation');
  const message = authFailureMessage(
    new ApiError(400, 'private-verification-token'),
    'verify',
  );
  assert.match(message, /Invalid or expired verification link/);
  assert.doesNotMatch(message, /private-verification-token/);
  assert.match(
    authFailureMessage(new ApiError(429, 'private'), 'verify'),
    /Too many attempts/,
  );
});
