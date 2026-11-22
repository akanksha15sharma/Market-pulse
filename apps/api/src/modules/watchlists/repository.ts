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
    return db.$transaction(
      async (tx) => {
        // One per-user lock serializes creation and membership changes across processes.
        // Read committed counts after this lock see the previous writer's commit.
        const users = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
        if (!users.length) throw new HttpError(401, 'Sign in to continue');
        return operation(tx);
      },
      { isolationLevel: 'ReadCommitted' },
    );
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
      return write(userId, async (tx) => {
        if (
          (await tx.watchlist.count({ where: { userId } })) >=
          WATCHLIST_LIMITS.lists
        )
          throw new HttpError(409, 'You can create up to 5 watchlists.');
        return tx.watchlist.create({ data: { userId, name }, include });
      });
    },
    rename(userId: string, id: string, name: string) {
      return write(userId, async (tx) => {
        await owned(tx, userId, id);
        return tx.watchlist.update({
          where: { id, userId },
          data: { name },
          include,
        });
      });
    },
    delete(userId: string, id: string) {
      return write(userId, async (tx) => {
        const result = await tx.watchlist.deleteMany({ where: { id, userId } });
        if (!result.count) throw notFound();
      });
    },
    add(userId: string, id: string, assetId: string) {
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
        return owned(tx, userId, id);
      });
    },
    remove(userId: string, id: string, assetId: string) {
      return write(userId, async (tx) => {
        await owned(tx, userId, id);
        await tx.watchlistItem.deleteMany({
          where: { watchlistId: id, assetId },
        });
      });
    },
  };
}
