import type {
  NotificationQuery,
  NotificationPreferencePatch,
} from '@marketpulse/contracts';
import { notificationPreferenceDefaults } from '@marketpulse/contracts';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http-error.js';
import type { NotificationPosition } from './cursor.js';
import { notificationTransaction } from './transaction.js';

export function createNotificationRepository(db: PrismaClient) {
  const write = <T>(
    userId: string,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) => notificationTransaction(db, userId, operation);
  return {
    history(
      userId: string,
      query: NotificationQuery,
      position?: NotificationPosition,
    ) {
      return db.$transaction(
        async (tx) => {
          const rows = await tx.notification.findMany({
            where: {
              userId,
              ...(query.filter === 'unread'
                ? { readAt: null }
                : query.filter === 'read'
                  ? { readAt: { not: null } }
                  : {}),
              ...(position
                ? {
                    OR: [
                      { createdAt: { lt: position.createdAt } },
                      {
                        createdAt: position.createdAt,
                        id: { lt: position.id },
                      },
                    ],
                  }
                : {}),
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: query.limit + 1,
          });
          const unreadCount = await tx.notification.count({
            where: { userId, readAt: null },
          });
          const lists = await tx.watchlist.findMany({
            where: {
              userId,
              id: {
                in: rows
                  .filter((row) => row.subjectType === 'WATCHLIST')
                  .flatMap((row) => (row.subjectId ? [row.subjectId] : [])),
              },
            },
            select: { id: true },
          });
          return {
            rows,
            unreadCount,
            ownedWatchlistIds: new Set(lists.map((row) => row.id)),
          };
        },
        { isolationLevel: 'RepeatableRead', maxWait: 10_000, timeout: 20_000 },
      );
    },
    unreadCount: (userId: string) =>
      db.notification.count({ where: { userId, readAt: null } }),
    setRead(userId: string, id: string, read: boolean) {
      return write(userId, async (tx) => {
        const existing = await tx.notification.findFirst({
          where: { userId, id },
        });
        if (!existing) throw new HttpError(404, 'Notification not found');
        if ((existing.readAt !== null) !== read) {
          await tx.notification.updateMany({
            where: { userId, id },
            data: { readAt: read ? new Date() : null },
          });
        }
        const row = await tx.notification.findFirstOrThrow({
          where: { userId, id },
        });
        const owned =
          row.subjectType === 'WATCHLIST' && row.subjectId
            ? await tx.watchlist.findFirst({
                where: { id: row.subjectId, userId },
                select: { id: true },
              })
            : null;
        return { row, ownedWatchlistIds: new Set(owned ? [owned.id] : []) };
      });
    },
    markAllRead(userId: string) {
      return write(userId, async (tx) => {
        // One statement touches only currently unread rows; repeats preserve timestamps.
        const result = await tx.notification.updateMany({
          where: { userId, readAt: null },
          data: { readAt: new Date() },
        });
        return result.count;
      });
    },
    preferences: (userId: string) =>
      db.notificationPreference.findUnique({ where: { userId } }),
    patchPreferences(userId: string, patch: NotificationPreferencePatch) {
      return write(userId, (tx) =>
        tx.notificationPreference.upsert({
          where: { userId },
          create: { userId, ...notificationPreferenceDefaults, ...patch },
          update: patch,
        }),
      );
    },
  };
}
