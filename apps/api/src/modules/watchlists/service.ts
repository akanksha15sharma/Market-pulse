import { watchlistInputSchema, watchlistSchema } from '@marketpulse/contracts';
import type { PrismaClient } from '../../generated/prisma/client.js';
import {
  createWatchlistRepository,
  type StoredWatchlist,
} from './repository.js';

function publicList(list: StoredWatchlist) {
  return watchlistSchema.parse({
    id: list.id,
    name: list.name,
    createdAt: list.createdAt.toISOString(),
    items: list.items.map((item) => ({
      asset: item.asset,
      available: item.asset.isActive,
      addedAt: item.createdAt.toISOString(),
    })),
  });
}
export function createWatchlistService(db: PrismaClient) {
  const repo = createWatchlistRepository(db);
  return {
    async list(userId: string) {
      return (await repo.list(userId)).map(publicList);
    },
    async get(userId: string, id: string) {
      return publicList(await repo.get(userId, id));
    },
    async create(userId: string, input: unknown) {
      return publicList(
        await repo.create(userId, watchlistInputSchema.parse(input).name),
      );
    },
    async rename(userId: string, id: string, input: unknown) {
      return publicList(
        await repo.rename(userId, id, watchlistInputSchema.parse(input).name),
      );
    },
    delete: repo.delete,
    async add(userId: string, id: string, assetId: string) {
      return publicList(await repo.add(userId, id, assetId));
    },
    remove: repo.remove,
  };
}
export type WatchlistService = ReturnType<typeof createWatchlistService>;
