import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  notificationKindSchema,
  notificationEventKindSchema,
  notificationEventKey,
  notificationEventKeySchema,
  notificationEventSchema,
  notificationCategories,
  notificationSubjectType,
  notificationPreferenceDefaults,
  notificationPreferencesSchema,
  notificationPreferencePatchSchema,
  notificationHistoryItemSchema,
  legacyNotificationMessage,
  notificationQuerySchema,
  notificationSummarySchema,
  notificationReadSchema,
  notificationReadAllSchema,
} from '@marketpulse/contracts';
import {
  NotificationKind,
  NotificationSubjectType,
} from '../../src/generated/prisma/enums.js';

const userId = randomUUID();
const operation = randomUUID();
const event = {
  userId,
  kind: 'SIGNED_IN' as const,
  eventKey: notificationEventKey('SIGNED_IN', operation),
  subjectType: 'ACCOUNT' as const,
  subjectId: userId,
  message: 'You signed in to MarketPulse.',
};
const history = {
  id: randomUUID(),
  kind: event.kind,
  message: event.message,
  subjectType: event.subjectType,
  subjectId: userId,
  actionUrl: '/account',
  createdAt: new Date().toISOString(),
  readAt: null,
};

test('notification kinds agree with Prisma and cannot represent new price alerts', () => {
  assert.deepEqual(
    [...notificationKindSchema.options].sort(),
    Object.values(NotificationKind).sort(),
  );
  assert.deepEqual(Object.values(NotificationSubjectType).sort(), [
    'ACCOUNT',
    'WATCHLIST',
  ]);
  assert.equal(notificationEventKindSchema.safeParse('LEGACY').success, false);
  for (const kind of [
    'PRICE_ALERT',
    'PRICE_TARGET_REACHED',
    'TRADINGVIEW_PRICE',
  ])
    assert.equal(notificationKindSchema.safeParse(kind).success, false);
  for (const kind of notificationEventKindSchema.options)
    assert.ok(notificationCategories[kind]);
  assert.equal(notificationCategories.PASSWORD_RESET, 'SECURITY');
  assert.equal(notificationCategories.SESSION_REVOKED, 'SECURITY');
  assert.equal(notificationCategories.EMAIL_VERIFIED, 'SECURITY');
});

test('event keys are stable per kind/operation and validated before use', () => {
  const key = notificationEventKey('SIGNED_IN', operation);
  assert.equal(key, notificationEventKey('SIGNED_IN', operation.toUpperCase()));
  assert.notEqual(key, notificationEventKey('ACCOUNT_CREATED', operation));
  assert.notEqual(key, notificationEventKey('SIGNED_IN', randomUUID()));
  assert.equal(notificationEventKeySchema.parse(key), key);
  for (const id of ['', 'not-a-uuid', '00000000-0000-0000-0000-000000000000'])
    assert.throws(() => notificationEventKey('SIGNED_IN', id));
  assert.throws(() => notificationEventKey('LEGACY' as never, operation));
  assert.equal(notificationEventKeySchema.safeParse(` ${key}`).success, false);
});

test('new events require consistent keys and account/watchlist subjects', () => {
  assert.deepEqual(notificationEventSchema.parse(event), event);
  for (const value of [
    { ...event, eventKey: notificationEventKey('ACCOUNT_CREATED', operation) },
    { ...event, eventKey: null },
    { ...event, subjectId: randomUUID() },
    { ...event, subjectType: 'WATCHLIST' },
    { ...event, message: '   ' },
    { ...event, alertEventId: randomUUID() },
    { ...event, price: '100' },
  ])
    assert.equal(notificationEventSchema.safeParse(value).success, false);
  assert.equal(notificationSubjectType('WATCHLIST_ASSET_ADDED'), 'WATCHLIST');
  assert.equal(
    notificationEventSchema.safeParse({
      ...event,
      kind: 'WATCHLIST_ASSET_ADDED',
      eventKey: notificationEventKey('WATCHLIST_ASSET_ADDED', operation),
      subjectType: 'WATCHLIST',
      subjectId: randomUUID(),
    }).success,
    true,
  );
});

test('preferences default on without making essential security or price delivery configurable', () => {
  assert.deepEqual(notificationPreferenceDefaults, {
    accountActivityEnabled: true,
    watchlistActivityEnabled: true,
  });
  assert.equal(Object.isFrozen(notificationPreferenceDefaults), true);
  assert.equal(
    notificationPreferencesSchema.safeParse({
      ...notificationPreferenceDefaults,
      securityNotificationsRequired: true,
    }).success,
    true,
  );
  assert.deepEqual(
    notificationPreferencePatchSchema.parse({
      watchlistActivityEnabled: false,
    }),
    { watchlistActivityEnabled: false },
  );
  for (const value of [
    {},
    { securityNotificationsRequired: false },
    { emailEnabled: true },
    { nativePriceAlerts: true },
    { accountActivityEnabled: 'false' },
  ])
    assert.equal(
      notificationPreferencePatchSchema.safeParse(value).success,
      false,
    );
  assert.equal(
    notificationPreferencesSchema.safeParse({
      ...notificationPreferenceDefaults,
      securityNotificationsRequired: false,
    }).success,
    false,
  );
});

test('legacy display remains neutral and new history cannot link to arbitrary destinations', () => {
  const legacy = {
    ...history,
    kind: 'LEGACY',
    message: legacyNotificationMessage,
    subjectType: null,
    subjectId: null,
    actionUrl: null,
  };
  assert.equal(notificationHistoryItemSchema.safeParse(legacy).success, true);
  assert.equal(
    notificationHistoryItemSchema.safeParse({
      ...legacy,
      message: 'A price target was reached at $100',
    }).success,
    false,
  );
  assert.equal(
    notificationHistoryItemSchema.safeParse({
      ...legacy,
      actionUrl: '/account',
    }).success,
    false,
  );
  assert.equal(notificationHistoryItemSchema.safeParse(history).success, true);
  for (const actionUrl of [
    'https://untrusted.example',
    '//untrusted.example',
    'javascript:alert(1)',
    '/watchlists',
  ])
    assert.equal(
      notificationHistoryItemSchema.safeParse({ ...history, actionUrl })
        .success,
      false,
    );
  const listId = randomUUID();
  const watchlist = {
    ...history,
    kind: 'WATCHLIST_DELETED',
    subjectType: 'WATCHLIST',
    subjectId: listId,
    actionUrl: '/watchlists',
  };
  assert.equal(
    notificationHistoryItemSchema.safeParse(watchlist).success,
    true,
  );
  assert.equal(
    notificationHistoryItemSchema.safeParse({
      ...watchlist,
      actionUrl: `/watchlists?list=${listId}`,
    }).success,
    true,
  );
  assert.equal(
    notificationHistoryItemSchema.safeParse({
      ...watchlist,
      actionUrl: `/watchlists?list=${randomUUID()}`,
    }).success,
    false,
  );
});

test('read/history contracts are bounded and disabled summary cannot pretend zero unread', () => {
  assert.deepEqual(notificationQuerySchema.parse({}), {
    filter: 'all',
    limit: 20,
  });
  for (const value of [
    { limit: 0 },
    { limit: 51 },
    { cursor: 'x'.repeat(257) },
    { userId },
    { filter: 'other' },
  ])
    assert.equal(notificationQuerySchema.safeParse(value).success, false);
  assert.equal(notificationReadSchema.safeParse({ read: true }).success, true);
  assert.equal(
    notificationReadSchema.safeParse({ read: 'false' }).success,
    false,
  );
  assert.equal(
    notificationReadSchema.safeParse({ read: true, userId }).success,
    false,
  );
  assert.equal(notificationReadAllSchema.safeParse({}).success, true);
  assert.equal(notificationReadAllSchema.safeParse({ userId }).success, false);
  assert.equal(
    notificationSummarySchema.safeParse({ enabled: false, unreadCount: null })
      .success,
    true,
  );
  assert.equal(
    notificationSummarySchema.safeParse({ enabled: false, unreadCount: 0 })
      .success,
    false,
  );
  for (const unreadCount of [-1, 0.5])
    assert.equal(
      notificationSummarySchema.safeParse({ enabled: true, unreadCount })
        .success,
      false,
    );
});
