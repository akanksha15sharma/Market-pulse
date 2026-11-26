import {
  announceApiWrite,
  sessionChangeEvent,
  notificationChangeEvent,
} from '../src/lib/api-events';
import { NotificationItem } from '../src/features/notifications/NotificationItem';
import { notificationHistoryItemSchema } from '@marketpulse/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import {
  loadNotifications,
  loadNotificationSummary,
  loadNotificationPreferences,
  saveNotificationPreferences,
  setNotificationRead,
  markAllNotificationsRead,
} from '../src/features/notifications/api';
import {
  NotificationContext,
  type NotificationState,
} from '../src/features/notifications/context';
import { NotificationBell } from '../src/features/notifications/NotificationBell';
import { NotificationsPage } from '../src/pages/NotificationsPage';
import { ApiError } from '../src/lib/api-client';

const id = '00000000-0000-4000-8000-000000000001';
const item = {
  id,
  kind: 'SIGNED_IN',
  message: '<script>untrusted text</script>',
  createdAt: '2026-01-01T12:00:00.000Z',
  readAt: null,
  subjectType: 'ACCOUNT',
  subjectId: id,
  actionUrl: '/account',
};
const preferences = {
  accountActivityEnabled: true,
  watchlistActivityEnabled: false,
  securityNotificationsRequired: true,
};
function render(
  component: React.ReactNode,
  state: Partial<NotificationState> = {},
) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <NotificationContext.Provider
        value={{
          status: 'ready',
          unreadCount: 2,
          revision: 0,
          refresh() {},
          expire() {},
          ...state,
        }}
      >
        {component}
      </NotificationContext.Provider>
    </MemoryRouter>,
  );
}

test('notification bell has a useful accessible name, honest unknown state and capped visual count', () => {
  assert.match(
    render(<NotificationBell />),
    /aria-label="Notifications — 2 unread"/,
  );
  assert.match(render(<NotificationBell />, { unreadCount: 123 }), /99\+/);
  assert.match(
    render(<NotificationBell />, { unreadCount: 123 }),
    /123 unread/,
  );
  assert.ok(
    !render(<NotificationBell />, { unreadCount: 0 }).includes(
      'notification-badge',
    ),
  );
  assert.equal(
    render(<NotificationBell />, { status: 'guest', unreadCount: null }),
    '',
  );
  assert.match(
    render(<NotificationBell />, { status: 'error', unreadCount: null }),
    /unread count unavailable/,
  );
});
test('inbox distinguishes loading, unavailable and request failure from empty history', () => {
  const pending = render(<NotificationsPage />, {
    status: 'loading',
    unreadCount: null,
  });
  assert.match(pending, /Loading your private inbox/);
  assert.ok(!pending.includes('caught up'));
  const failure = render(<NotificationsPage />, {
    status: 'error',
    unreadCount: null,
  });
  assert.match(failure, /role="alert"/);
  assert.match(failure, /Try again/);
  assert.ok(!failure.includes('0 unread'));
  const unavailable = render(<NotificationsPage />, {
    status: 'disabled',
    unreadCount: null,
  });
  assert.match(unavailable, /currently unavailable/);
  const ready = render(<NotificationsPage />);
  for (const label of [
    'Mark all as read',
    'Refresh',
    'Filter notifications',
    'Notification preferences',
    'Loading notifications',
  ])
    assert.ok(ready.includes(label));
});
test('history and summary requests are private, bounded, cursor-encoded and validated at runtime', async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  try {
    globalThis.fetch = async (path, options) => {
      assert.equal(options?.credentials, 'same-origin');
      assert.equal(options?.cache, 'no-store');
      requests.push(String(path));
      return new Response(
        JSON.stringify(
          String(path).endsWith('/summary')
            ? { enabled: true, unreadCount: 3 }
            : {
                notifications: [item],
                unreadCount: 3,
                nextCursor: 'opaque+cursor',
              },
        ),
      );
    };
    assert.equal((await loadNotificationSummary()).unreadCount, 3);
    const response = await loadNotifications({
      filter: 'unread',
      limit: 20,
      cursor: 'opaque+cursor',
    });
    assert.equal(response.notifications[0]!.message, item.message);
    assert.ok(requests[1]!.includes('cursor=opaque%2Bcursor'));
    assert.throws(() => loadNotifications({ limit: 51 }));
    assert.throws(() => loadNotifications({ userId: id }));
    assert.equal(requests.length, 2);
    for (const actionUrl of [
      'https://evil.example',
      'javascript:alert(1)',
      '/account?token=secret',
    ]) {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            notifications: [{ ...item, actionUrl }],
            unreadCount: 1,
            nextCursor: null,
          }),
        );
      await assert.rejects(
        () => loadNotifications({}),
        (error) => error instanceof ApiError && error.status === 502,
      );
    }
    globalThis.fetch = async () => new Response('{"enabled":true}');
    await assert.rejects(loadNotificationSummary, /temporarily unavailable/);
  } finally {
    globalThis.fetch = original;
  }
});
test('read controls, read-all and preferences use existing CSRF protection and send only allowed fields', async () => {
  const original = globalThis.fetch;
  const writes: { path: string; method: string | undefined; body: unknown }[] =
    [];
  try {
    globalThis.fetch = async (path, options) => {
      if (String(path).endsWith('/auth/csrf'))
        return new Response('{"csrfToken":"signed-test-only"}');
      if ((options?.method ?? 'GET') === 'GET')
        return new Response(JSON.stringify(preferences));
      assert.equal(
        (options?.headers as Record<string, string>)['X-CSRF-Token'],
        'signed-test-only',
      );
      writes.push({
        path: String(path),
        method: options?.method,
        body: JSON.parse(String(options?.body)),
      });
      return new Response(
        JSON.stringify(
          String(path).endsWith('/read-all')
            ? { updatedCount: 1 }
            : String(path).endsWith('/preferences')
              ? preferences
              : {
                  notification: { ...item, readAt: '2026-01-02T12:00:00.000Z' },
                },
        ),
      );
    };
    await setNotificationRead(id, true);
    await setNotificationRead(id, false);
    await markAllNotificationsRead();
    assert.deepEqual(await loadNotificationPreferences(), preferences);
    await saveNotificationPreferences({ watchlistActivityEnabled: false });
    assert.deepEqual(
      writes.map((row) => row.body),
      [
        { read: true },
        { read: false },
        {},
        { watchlistActivityEnabled: false },
      ],
    );
    assert.deepEqual(
      writes.map((row) => row.method),
      ['PATCH', 'PATCH', 'POST', 'PATCH'],
    );
    assert.equal(writes[0]!.path, `/api/v1/notifications/${id}/read`);
    assert.throws(() => setNotificationRead('../account', true));
    assert.throws(() =>
      saveNotificationPreferences({ securityNotificationsRequired: false }),
    );
    assert.equal(writes.length, 4);
  } finally {
    globalThis.fetch = original;
  }
});
test('expired sessions, rate limits and unavailable services propagate errors instead of inventing empty data', async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [401, 403, 429, 503]) {
      globalThis.fetch = async () =>
        new Response('{"error":"Please try later"}', { status });
      await assert.rejects(
        () => loadNotifications({}),
        (error) => error instanceof ApiError && error.status === status,
      );
    }
    globalThis.fetch = async () => {
      throw new Error('offline');
    };
    await assert.rejects(loadNotificationSummary, /Cannot reach/);
    globalThis.fetch = async () =>
      new Response('{"accountActivityEnabled":true}');
    await assert.rejects(
      loadNotificationPreferences,
      /temporarily unavailable/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('notification content renders as text with safe links and explicit read controls', () => {
  const unread = render(
    <NotificationItem
      item={notificationHistoryItemSchema.parse(item)}
      busy={false}
      perform={async () => {}}
    />,
  );
  assert.ok(unread.includes('&lt;script&gt;untrusted text&lt;/script&gt;'));
  assert.ok(!unread.includes('<script>'));
  assert.ok(unread.includes('href="/account"'));
  assert.ok(unread.includes('Mark as read'));
  const read = render(
    <NotificationItem
      item={notificationHistoryItemSchema.parse({
        ...item,
        readAt: item.createdAt,
      })}
      busy={true}
      perform={async () => {}}
    />,
  );
  assert.ok(read.includes('Mark as unread'));
  assert.ok(read.includes('disabled=""'));
});

test('blocked cross-tab messaging cannot turn successful writes into failures; local session signals contain no private data', () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalChannel = globalThis.BroadcastChannel;
  const events: string[] = [];
  const target = new EventTarget();
  target.addEventListener(sessionChangeEvent, (event) =>
    events.push(event.type),
  );
  target.addEventListener(notificationChangeEvent, (event) =>
    events.push(event.type),
  );
  try {
    Object.defineProperty(globalThis, 'window', {
      value: target,
      configurable: true,
    });
    globalThis.BroadcastChannel = class {
      constructor() {
        throw new Error('Browser policy blocked messaging');
      }
    } as unknown as typeof BroadcastChannel;
    assert.doesNotThrow(() => announceApiWrite('/auth/login'));
    assert.doesNotThrow(() => announceApiWrite('/notifications/read-all'));
    assert.deepEqual(events, [sessionChangeEvent, notificationChangeEvent]);
  } finally {
    globalThis.BroadcastChannel = originalChannel;
    if (originalWindow)
      Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
