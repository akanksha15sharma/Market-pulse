import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createMemoryRouter,
  MemoryRouter,
  RouterProvider,
  type ActionFunctionArgs,
} from 'react-router';
import type { QuoteDto, WatchlistView } from '@marketpulse/contracts';
import { WatchlistAssets } from '../src/features/watchlists/WatchlistAssets';
import {
  watchlistsAction,
  watchlistsLoader,
} from '../src/features/watchlists/actions';
import { WatchlistsPage } from '../src/pages/WatchlistsPage';

const id = '00000000-0000-4000-8000-000000000001';
const assetId = '00000000-0000-4000-8000-000000000002';
const date = new Date().toISOString();
const list: WatchlistView = {
  id,
  name: 'Core ideas',
  createdAt: date,
  items: [
    {
      asset: {
        id: assetId,
        key: 'stock:aapl',
        symbol: 'AAPL',
        name: 'Apple',
        type: 'STOCK',
        exchange: 'NASDAQ',
        quoteCurrency: 'USD',
        isDemoOnly: true,
      },
      available: true,
      addedAt: date,
    },
  ],
};
const quote: QuoteDto = {
  assetId,
  price: '120.25',
  changePercent: '-1.5',
  provider: 'DEMO',
  mode: 'DEMO',
  currency: 'USD',
  simulated: true,
  status: 'fresh',
  sourceAt: date,
  fetchedAt: date,
  reason: null,
};
function action(fields: Record<string, string>) {
  return watchlistsAction({
    request: new Request('http://localhost/watchlists', {
      method: 'POST',
      body: new URLSearchParams(fields),
    }),
    params: {},
    context: {},
  } as ActionFunctionArgs);
}

test('private watchlist loader validates persisted data and redirects only unauthenticated sessions', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ watchlists: [list] }));
    assert.deepEqual(await watchlistsLoader(), { watchlists: [list] });
    globalThis.fetch = async () =>
      new Response('{"error":"Sign in"}', { status: 401 });
    await assert.rejects(
      watchlistsLoader,
      (error: unknown) =>
        error instanceof Response &&
        error.status === 302 &&
        error.headers.get('Location') === '/login',
    );
    globalThis.fetch = async () =>
      new Response('{"error":"Unavailable"}', { status: 503 });
    await assert.rejects(watchlistsLoader, /Unavailable/);
    globalThis.fetch = async () =>
      new Response('{"watchlists":[{"id":"invalid"}]}');
    await assert.rejects(watchlistsLoader);
  } finally {
    globalThis.fetch = original;
  }
});

test('create and rename use authenticated CSRF requests, validate names and never send owner fields', async () => {
  const original = globalThis.fetch;
  const writes: { path: string; method: string | undefined; body: unknown }[] =
    [];
  try {
    globalThis.fetch = async (input, options) => {
      assert.equal(options?.credentials, 'same-origin');
      if (String(input).endsWith('/auth/csrf'))
        return new Response('{"csrfToken":"signed"}');
      assert.equal(
        (options?.headers as Record<string, string>)['X-CSRF-Token'],
        'signed',
      );
      writes.push({
        path: String(input),
        method: options?.method,
        body: JSON.parse(String(options?.body)),
      });
      return new Response(JSON.stringify({ watchlist: list }));
    };
    const created = await action({
      intent: 'create',
      name: '  Core ideas  ',
      userId: 'spoofed',
    });
    assert.ok(created instanceof Response);
    assert.equal(created.headers.get('Location'), `/watchlists?list=${id}`);
    const renamed = await action({
      intent: 'rename',
      id,
      name: 'New perspective',
    });
    assert.ok(!(renamed instanceof Response) && renamed.data.ok);
    assert.deepEqual(writes, [
      {
        path: '/api/v1/watchlists',
        method: 'POST',
        body: { name: 'Core ideas' },
      },
      {
        path: `/api/v1/watchlists/${id}`,
        method: 'PATCH',
        body: { name: 'New perspective' },
      },
    ]);
    const before = writes.length;
    const invalid = await action({ intent: 'create', name: '   ' });
    assert.ok(!(invalid instanceof Response) && !invalid.data.ok);
    assert.equal(writes.length, before);
  } finally {
    globalThis.fetch = original;
  }
});

test('add, remove and delete target list and asset UUIDs with correct HTTP methods', async () => {
  const original = globalThis.fetch;
  const writes: string[] = [];
  try {
    globalThis.fetch = async (input, options) => {
      if (String(input).endsWith('/auth/csrf'))
        return new Response('{"csrfToken":"signed"}');
      writes.push(`${options?.method} ${String(input)}`);
      return options?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : new Response('{}');
    };
    await action({ intent: 'add', id, assetId });
    await action({ intent: 'remove', id, assetId });
    const deleted = await action({ intent: 'delete', id });
    assert.ok(
      deleted instanceof Response &&
        deleted.headers.get('Location') === '/watchlists',
    );
    assert.deepEqual(writes, [
      `POST /api/v1/watchlists/${id}/items`,
      `DELETE /api/v1/watchlists/${id}/items/${assetId}`,
      `DELETE /api/v1/watchlists/${id}`,
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test('failed writes expose an error rather than success, expired sessions return to sign-in', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input) =>
      String(input).endsWith('/auth/csrf')
        ? new Response('{"csrfToken":"signed"}')
        : new Response('{"error":"List limit reached"}', { status: 409 });
    const failed = await action({ intent: 'create', name: 'Sixth' });
    assert.ok(!(failed instanceof Response) && !failed.data.ok);
    assert.equal(failed.data.message, 'List limit reached');
    globalThis.fetch = async () =>
      new Response('{"error":"Expired"}', { status: 401 });
    const expired = await action({ intent: 'delete', id });
    assert.ok(
      expired instanceof Response &&
        expired.headers.get('Location') === '/login',
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('saved assets show cache provenance and simulated labels; inactive assets remain removable without old prices', () => {
  const render = (items: WatchlistView['items']) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <WatchlistAssets
          items={items}
          quotes={[quote]}
          disabled={false}
          remove={(asset) => <button>Remove {asset.name}</button>}
        />
      </MemoryRouter>,
    );
  const active = render(list.items);
  assert.match(active, /\$120\.25/);
  assert.match(active, /-1.50%/);
  assert.match(active, /Simulated data/);
  assert.match(active, /DEMO/);
  assert.match(active, /Remove Apple/);
  assert.match(active, new RegExp(`/assets/${assetId}`));
  const inactive = render([{ ...list.items[0]!, available: false }]);
  assert.match(inactive, /No longer in the active catalog/);
  assert.match(inactive, /Price unavailable/);
  assert.doesNotMatch(inactive, /\$120\.25/);
  assert.match(inactive, /Remove Apple/);
  assert.match(render([]), /saved privately to your account/);
});

test('watchlist page exposes list selection, labeled management forms and five-list capacity', () => {
  const lists = Array.from({ length: 5 }, (_, index) => ({
    ...list,
    id: `00000000-0000-4000-8000-00000000000${index + 3}`,
    name: `List ${index + 1}`,
  }));
  const router = createMemoryRouter(
    [
      {
        id: 'watchlists',
        path: '/watchlists',
        element: <WatchlistsPage />,
        loader: watchlistsLoader,
        action: watchlistsAction,
      },
    ],
    {
      initialEntries: [`/watchlists?list=${lists[1]!.id}`],
      hydrationData: { loaderData: { watchlists: { watchlists: lists } } },
    },
  );
  try {
    const html = renderToStaticMarkup(<RouterProvider router={router} />);
    assert.match(html, /List 2/);
    assert.match(html, /aria-current="page"/);
    assert.match(html, /All five list slots are in use/);
    assert.match(html, /id="watchlist-name"[^>]*disabled/);
    assert.match(html, /List name/);
    assert.match(html, /Rename/);
    assert.match(html, /Delete list/);
    assert.match(html, /Remove Apple from List 2/);
  } finally {
    router.dispose();
  }
});
