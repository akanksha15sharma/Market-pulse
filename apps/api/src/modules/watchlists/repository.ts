import { randomUUID } from 'node:crypto';
import { recordNotification } from '../notifications/producer.js';
import { notificationTransaction } from '../notifications/transaction.js';
import { WATCHLIST_LIMITS } from '@marketpulse/contracts';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http-error.js';

const include = {
  items: {
    include: { asset: true },
    orderBy: [{ createdAt: 'asc' }, { assetId: 'asc' }],
  },
} satisfies Prisma.WatchlistInclude;
export type StoredWatchlist = Prisma.WatchlistGetPayload<{
  include: typeof include;
}>;
const notFound = () => new HttpError(404, 'Watchlist not found');

export function createWatchlistRepository(db: PrismaClient) {
  async function owned(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string,
  ) {
    const list = await tx.watchlist.findFirst({
      where: { id, userId },
      include,
    });
    if (!list) throw notFound();
    return list;
  }
  function write<T>(
    userId: string,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return notificationTransaction(db, userId, operation);
  }
  return {
    list: (userId: string) =>
      db.watchlist.findMany({
        where: { userId },
        include,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    get: (userId: string, id: string) => owned(db, userId, id),
    create(userId: string, name: string) {
      const operationId = randomUUID();
      return write(userId, async (tx) => {
        if (
          (await tx.watchlist.count({ where: { userId } })) >=
          WATCHLIST_LIMITS.lists
        )
          throw new HttpError(409, 'You can create up to 5 watchlists.');
        const list = await tx.watchlist.create({
          data: { userId, name },
          include,
        });
        await recordNotification(tx, {
          userId,
          kind: 'WATCHLIST_CREATED',
          operationId,
          subjectId: list.id,
        });
        return list;
      });
    },
    rename(userId: string, id: string, name: string) {
      const operationId = randomUUID();
      return write(userId, async (tx) => {
        const existing = await owned(tx, userId, id);
        if (existing.name === name) return existing;
        const list = await tx.watchlist.update({
          where: { id, userId },
          data: { name },
          include,
        });
        await recordNotification(tx, {
          userId,
          kind: 'WATCHLIST_RENAMED',
          operationId,
          subjectId: id,
        });
        return list;
      });
    },
    delete(userId: string, id: string) {
      const operationId = randomUUID();
      return write(userId, async (tx) => {
        const result = await tx.watchlist.deleteMany({ where: { id, userId } });
        if (!result.count) throw notFound();
        await recordNotification(tx, {
          userId,
          kind: 'WATCHLIST_DELETED',
          operationId,
          subjectId: id,
        });
      });
    },
    add(userId: string, id: string, assetId: string) {
      const operationId = randomUUID();
      return write(userId, async (tx) => {
        const list = await owned(tx, userId, id);
        const asset = await tx.asset.findFirst({
          where: { id: assetId, isActive: true },
        });
        if (!asset)
          throw new HttpError(404, 'Asset is not available in the catalog');
        // Repeated adds are idempotent, including when a list is already full.
        if (list.items.some((item) => item.assetId === assetId)) return list;
        if (list.items.length >= WATCHLIST_LIMITS.items)
          throw new HttpError(409, 'A watchlist can contain up to 20 assets.');
        await tx.watchlistItem.create({ data: { watchlistId: id, assetId } });
        await recordNotification(tx, {
          userId,
          kind: 'WATCHLIST_ASSET_ADDED',
          operationId,
          subjectId: id,
        });
        return owned(tx, userId, id);
      });
    },
    remove(userId: string, id: string, assetId: string) {
      const operationId = randomUUID();
      return write(userId, async (tx) => {
        await owned(tx, userId, id);
        const result = await tx.watchlistItem.deleteMany({
          where: { watchlistId: id, assetId },
        });
        if (result.count)
          await recordNotification(tx, {
            userId,
            kind: 'WATCHLIST_ASSET_REMOVED',
            operationId,
            subjectId: id,
          });
      });
    },
  };
}
