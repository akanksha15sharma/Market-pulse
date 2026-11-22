import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createMemoryRouter,
  RouterProvider,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from 'react-router';
import type { AlertView, AlertEventView } from '@marketpulse/contracts';
import { alertsAction, alertsLoader } from '../src/features/alerts/actions';
import {
  AlertEligibility,
  AlertEventHistory,
} from '../src/features/alerts/AlertPresentation';
import { AlertsPage } from '../src/pages/AlertsPage';
const id = '00000000-0000-4000-8000-000000000001';
const assetId = '00000000-0000-4000-8000-000000000002';
const date = new Date().toISOString();
const alert: AlertView = {
  id,
  asset: {
    id: assetId,
    key: 'stock:aapl',
    name: 'Apple',
    symbol: 'AAPL',
    type: 'STOCK',
    exchange: 'NASDAQ',
    quoteCurrency: 'USD',
    isDemoOnly: true,
  },
  provider: 'DEMO',
  mode: 'DEMO',
  currency: 'USD',
  direction: 'ABOVE',
  threshold: '100.000000000000000000',
  status: 'ACTIVE',
  activation: 1,
  armedAt: date,
  createdAt: date,
  eligibility: 'real_data_required',
  latestEvent: null,
};
const event: AlertEventView = {
  id,
  activation: 1,
  observedPrice: '101.000000000000000001',
  targetPrice: '100.000000000000000000',
  direction: 'ABOVE',
  provider: 'COINPAPRIKA',
  mode: 'REAL',
  sourceAt: date,
  fetchedAt: date,
  triggeredAt: date,
  verifiedReal: true,
};
const listing = {
  alerts: [alert],
  total: 1,
  activeCount: 1,
  page: 1,
  limit: 20,
};
const loader = (query = '') =>
  alertsLoader({
    request: new Request(`http://localhost/alerts${query}`),
    params: {},
    context: {},
  } as LoaderFunctionArgs);
const action = (fields: Record<string, string>) =>
  alertsAction({
    request: new Request('http://localhost/alerts', {
      method: 'POST',
      body: new URLSearchParams(fields),
    }),
    params: {},
    context: {},
  } as ActionFunctionArgs);

test('private alert loader scopes queries, validates data and redirects only expired sessions', async () => {
  const original = globalThis.fetch;
  const paths: string[] = [];
  try {
    globalThis.fetch = async (input) => {
      paths.push(String(input));
      return Response.json(listing);
    };
    const loaded = await loader('?page=2&status=ACTIVE');
    assert.equal(loaded.alerts[0]?.eligibility, 'real_data_required');
    assert.match(paths[0]!, /page=2/);
    assert.match(paths[0]!, /status=ACTIVE/);
    const calls = paths.length;
    await assert.rejects(
      () => loader('?page=0'),
      (error: unknown) => error instanceof Response && error.status === 302,
    );
    assert.equal(paths.length, calls);
    globalThis.fetch = async () =>
      new Response('{"error":"Expired"}', { status: 401 });
    await assert.rejects(
      () => loader(),
      (error: unknown) =>
        error instanceof Response && error.headers.get('Location') === '/login',
    );
    globalThis.fetch = async () =>
      new Response('{"error":"Unavailable"}', { status: 503 });
    await assert.rejects(() => loader(), /Unavailable/);
  } finally {
    globalThis.fetch = original;
  }
});

test('history inspection reads only owner-authorized API records with bounded pagination', async () => {
  const original = globalThis.fetch;
  const paths: string[] = [];
  try {
    globalThis.fetch = async (input) => {
      const path = String(input);
      paths.push(path);
      return Response.json(
        path.includes('/events')
          ? { events: [event], total: 1, page: 2, limit: 20 }
          : listing,
      );
    };
    const loaded = await loader(`?inspect=${id}&historyPage=2`);
    assert.equal(loaded.history?.events[0]?.observedPrice, event.observedPrice);
    assert.equal(paths.length, 2);
    assert.match(paths[1]!, /events\?page=2&limit=20/);
    globalThis.fetch = async (input) =>
      String(input).includes('/alerts?')
        ? Response.json({ ...listing, alerts: [] })
        : new Response('{"error":"Alert not found"}', { status: 404 });
    await assert.rejects(() => loader(`?inspect=${id}`), /Alert not found/);
  } finally {
    globalThis.fetch = original;
  }
});

test('creating a stock target uses CSRF and sends only the target, not source or pretend observations', async () => {
  const original = globalThis.fetch;
  const writes: unknown[] = [];
  try {
    globalThis.fetch = async (input, options) => {
      if (String(input).endsWith('/auth/csrf'))
        return Response.json({ csrfToken: 'signed' });
      assert.equal(options?.credentials, 'same-origin');
      assert.equal(
        (options?.headers as Record<string, string>)['X-CSRF-Token'],
        'signed',
      );
      writes.push(JSON.parse(String(options?.body)));
      return Response.json({ alert });
    };
    const result = await action({
      intent: 'create',
      assetId,
      direction: 'ABOVE',
      threshold: '100',
      provider: 'COINPAPRIKA',
      currentPrice: '200',
      userId: 'spoofed',
    });
    assert.ok(
      result instanceof Response &&
        result.headers.get('Location') === `/alerts?inspect=${id}`,
    );
    assert.deepEqual(writes, [
      { assetId, direction: 'ABOVE', threshold: '100' },
    ]);
    const invalid = await action({
      intent: 'create',
      assetId,
      direction: 'ABOVE',
      threshold: '1e3',
    });
    assert.ok(!(invalid instanceof Response) && !invalid.data.ok);
    assert.equal(writes.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('edit, pause, rearm and delete use the exact API actions without fabricating trigger events', async () => {
  const original = globalThis.fetch;
  const paths: string[] = [];
  try {
    globalThis.fetch = async (input, options) => {
      if (String(input).endsWith('/auth/csrf'))
        return Response.json({ csrfToken: 'signed' });
      paths.push(`${options?.method} ${String(input)}`);
      return options?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : Response.json({ alert });
    };
    const edited = await action({
      intent: 'edit',
      id,
      direction: 'BELOW',
      threshold: '90',
    });
    assert.ok(!(edited instanceof Response) && edited.data.ok);
    assert.match(edited.data.message, /paused/);
    await action({ intent: 'pause', id });
    await action({ intent: 'rearm', id });
    const deleted = await action({ intent: 'delete', id });
    assert.ok(
      deleted instanceof Response &&
        deleted.headers.get('Location') === '/alerts',
    );
    assert.deepEqual(paths, [
      `PATCH /api/v1/alerts/${id}`,
      `POST /api/v1/alerts/${id}/pause`,
      `POST /api/v1/alerts/${id}/rearm`,
      `DELETE /api/v1/alerts/${id}`,
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test('failed mutations keep errors visible and expired sessions redirect to sign-in', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input) =>
      String(input).endsWith('/auth/csrf')
        ? Response.json({ csrfToken: 'signed' })
        : new Response('{"error":"Active alert limit reached"}', {
            status: 409,
          });
    const result = await action({ intent: 'rearm', id });
    assert.ok(!(result instanceof Response) && !result.data.ok);
    assert.match(result.data.message, /limit reached/);
    globalThis.fetch = async () => new Response('{}', { status: 401 });
    const expired = await action({ intent: 'pause', id });
    assert.ok(
      expired instanceof Response &&
        expired.headers.get('Location') === '/login',
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('simulated stock targets and demo crypto are explicitly blocked, never advertised as reached', () => {
  const stock = renderToStaticMarkup(<AlertEligibility alert={alert} />);
  assert.match(stock, /Blocked: simulated data/);
  assert.match(stock, /can never trigger/);
  const crypto = renderToStaticMarkup(
    <AlertEligibility
      alert={{ ...alert, eligibility: 'real_crypto_disabled' }}
    />,
  );
  assert.match(crypto, /real crypto mode is disabled/);
});

test('trigger history retains exact target/source snapshots and distinguishes unverified legacy events', () => {
  const html = renderToStaticMarkup(<AlertEventHistory events={[event]} />);
  assert.match(html, /Target reached/);
  assert.match(html, /101.000000000000000001/);
  assert.match(html, /100.000000000000000000/);
  assert.match(html, /COINPAPRIKA/);
  assert.match(html, /Activation 1/);
  const legacy = renderToStaticMarkup(
    <AlertEventHistory
      events={[
        {
          ...event,
          verifiedReal: false,
          provider: null,
          mode: null,
          targetPrice: null,
          fetchedAt: null,
        },
      ]}
    />,
  );
  assert.match(legacy, /Legacy event/);
  assert.doesNotMatch(legacy, /<strong>Target reached/);
  assert.match(
    renderToStaticMarkup(<AlertEventHistory events={[]} />),
    /No target reached events yet/,
  );
});

test('responsive alert page has labeled forms, active capacity, blocked stock guidance and management controls', () => {
  const router = createMemoryRouter(
    [
      {
        id: 'alerts',
        path: '/alerts',
        element: <AlertsPage />,
        loader: alertsLoader,
        action: alertsAction,
      },
    ],
    {
      initialEntries: ['/alerts'],
      hydrationData: {
        loaderData: {
          alerts: {
            ...listing,
            inspected: alert,
            history: { events: [], total: 0, page: 1, limit: 20 },
          },
        },
      },
    },
  );
  try {
    const html = renderToStaticMarkup(<RouterProvider router={router} />);
    assert.match(html, /Target price \(USD\)/);
    assert.match(html, /Save &amp; arm target/);
    assert.match(html, /Pause/);
    assert.match(html, /Save changes &amp; pause/);
    assert.match(html, /Delete alert/);
    assert.match(html, /Blocked: simulated data/);
    assert.match(html, /never trigger alerts/);
    assert.match(html, /One event per activation/);
  } finally {
    router.dispose();
  }
});
