import {
  notificationCategories,
  notificationEventKey,
  notificationEventSchema,
  notificationPreferenceDefaults,
  notificationSubjectType,
  type NotificationEventKind,
} from '@marketpulse/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { lockNotificationUser } from './transaction.js';

// Server-owned text only: no passwords, tokens, email addresses or arbitrary URLs.
const messages = {
  ACCOUNT_CREATED: 'Your MarketPulse account was created.',
  SIGNED_IN: 'You signed in to your MarketPulse account.',
  SESSION_REVOKED: 'One or more of your account sessions were revoked.',
  PASSWORD_RESET: 'Your MarketPulse password was reset.',
  EMAIL_VERIFIED: 'Your MarketPulse email address was verified.',
  WATCHLIST_CREATED: 'You created a watchlist.',
  WATCHLIST_RENAMED: 'You renamed a watchlist.',
  WATCHLIST_DELETED: 'You deleted a watchlist.',
  WATCHLIST_ASSET_ADDED: 'You added an asset to a watchlist.',
  WATCHLIST_ASSET_REMOVED: 'You removed an asset from a watchlist.',
} satisfies Record<NotificationEventKind, string>;

// Internal only. Call ONLY after a genuine state change, using its transaction.
// Allocate operationId once outside that transaction callback; reuse for retries.
export async function recordNotification(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    kind: NotificationEventKind;
    operationId: string;
    subjectId?: string;
  },
) {
  const event = notificationEventSchema.parse({
    userId: input.userId,
    kind: input.kind,
    eventKey: notificationEventKey(input.kind, input.operationId),
    subjectType: notificationSubjectType(input.kind),
    subjectId: input.subjectId ?? input.userId,
    message: messages[input.kind],
  });
  await lockNotificationUser(tx, event.userId);
  const category = notificationCategories[event.kind];
  if (category !== 'SECURITY') {
    const preferences = await tx.notificationPreference.findUnique({
      where: { userId: event.userId },
    });
    const allowed = preferences ?? notificationPreferenceDefaults;
    if (category === 'ACCOUNT_ACTIVITY' && !allowed.accountActivityEnabled)
      return false;
    if (category === 'WATCHLIST_ACTIVITY' && !allowed.watchlistActivityEnabled)
      return false;
  }
  // ON CONFLICT DO NOTHING keeps a duplicate from aborting the business transaction.
  const result = await tx.notification.createMany({
    data: [event],
    skipDuplicates: true,
  });
  return result.count === 1;
}
