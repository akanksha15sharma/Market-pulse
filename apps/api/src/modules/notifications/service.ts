import {
  notificationReadResponseSchema,
  notificationReadAllResponseSchema,
  legacyNotificationMessage,
  notificationHistoryItemSchema,
  notificationHistorySchema,
  notificationPreferencesSchema,
  notificationPreferenceDefaults,
  notificationPreferencePatchSchema,
  notificationQuerySchema,
  notificationSummarySchema,
} from '@marketpulse/contracts';
import { z } from 'zod';
import type {
  Notification,
  PrismaClient,
} from '../../generated/prisma/client.js';
import { createNotificationCursor } from './cursor.js';
import { createNotificationRepository } from './repository.js';

function publicNotification(row: Notification, ownedWatchlistIds: Set<string>) {
  const legacy = row.kind === 'LEGACY';
  return notificationHistoryItemSchema.parse({
    id: row.id,
    kind: row.kind,
    message: legacy ? legacyNotificationMessage : row.message,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    subjectType: legacy ? null : row.subjectType,
    subjectId: legacy ? null : row.subjectId,
    actionUrl: legacy
      ? null
      : row.subjectType === 'ACCOUNT'
        ? '/account'
        : row.subjectId && ownedWatchlistIds.has(row.subjectId)
          ? `/watchlists?list=${row.subjectId}`
          : '/watchlists',
  });
}
function preferences(
  row: {
    accountActivityEnabled: boolean;
    watchlistActivityEnabled: boolean;
  } | null,
) {
  return notificationPreferencesSchema.parse({
    securityNotificationsRequired: true,
    // Deliberately select only public fields from the stored row.
    accountActivityEnabled:
      row?.accountActivityEnabled ??
      notificationPreferenceDefaults.accountActivityEnabled,
    watchlistActivityEnabled:
      row?.watchlistActivityEnabled ??
      notificationPreferenceDefaults.watchlistActivityEnabled,
  });
}
export function createNotificationService(
  db: PrismaClient,
  cursorSecret: string,
) {
  const repo = createNotificationRepository(db);
  const cursor = createNotificationCursor(cursorSecret);
  return {
    async history(userId: string, input: unknown) {
      const query = notificationQuerySchema.parse(input);
      const position = query.cursor
        ? cursor.decode(query.cursor, userId, query.filter)
        : undefined;
      const result = await repo.history(userId, query, position);
      const page = result.rows.slice(0, query.limit);
      const last = page.at(-1);
      return notificationHistorySchema.parse({
        notifications: page.map((row) =>
          publicNotification(row, result.ownedWatchlistIds),
        ),
        unreadCount: result.unreadCount,
        nextCursor:
          result.rows.length > query.limit && last
            ? cursor.encode(userId, query.filter, last)
            : null,
      });
    },
    async summary(userId: string) {
      return notificationSummarySchema.parse({
        enabled: true,
        unreadCount: await repo.unreadCount(userId),
      });
    },
    async setRead(userId: string, id: string, read: boolean) {
      const result = await repo.setRead(
        userId,
        z.uuid().parse(id),
        z.boolean().parse(read),
      );
      return notificationReadResponseSchema.parse({
        notification: publicNotification(result.row, result.ownedWatchlistIds),
      });
    },
    async markAllRead(userId: string) {
      return notificationReadAllResponseSchema.parse({
        updatedCount: await repo.markAllRead(userId),
      });
    },
    async preferences(userId: string) {
      return preferences(await repo.preferences(userId));
    },
    async patchPreferences(userId: string, input: unknown) {
      const row = await repo.patchPreferences(
        userId,
        notificationPreferencePatchSchema.parse(input),
      );
      return preferences(row);
    },
  };
}
export type NotificationService = ReturnType<typeof createNotificationService>;
