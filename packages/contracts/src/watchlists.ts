import { z } from 'zod';
import { assetSchema } from './markets.js';

export const WATCHLIST_LIMITS = { lists: 5, items: 20 } as const;
export const watchlistNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (name) =>
      Array.from(name).every((character) => {
        const code = character.charCodeAt(0);
        return code >= 32 && code !== 127;
      }),
    'Use a name without control characters',
  );
export const watchlistInputSchema = z
  .object({ name: watchlistNameSchema })
  .strict();
export const watchlistItemInputSchema = z
  .object({ assetId: z.uuid() })
  .strict();
export const watchlistSchema = z.object({
  id: z.uuid(),
  name: watchlistNameSchema,
  createdAt: z.iso.datetime(),
  items: z.array(
    z.object({
      asset: assetSchema,
      available: z.boolean(),
      addedAt: z.iso.datetime(),
    }),
  ),
});
export const watchlistsResponseSchema = z.object({
  watchlists: z.array(watchlistSchema),
});
export type WatchlistView = z.infer<typeof watchlistSchema>;
