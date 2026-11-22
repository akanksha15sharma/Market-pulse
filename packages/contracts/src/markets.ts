import { z } from 'zod';

export const historyRangeSchema = z.enum(['1D', '7D', '1M', '1Y']);
export type HistoryRange = z.infer<typeof historyRangeSchema>;
export const assetQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(''),
    type: z.enum(['CRYPTO', 'STOCK']).optional(),
    sort: z.enum(['symbol', 'name']).default('symbol'),
    page: z.coerce.number().int().min(1).max(100).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export const quoteQuerySchema = z
  .object({
    assetIds: z
      .string()
      .transform((value) => value.split(','))
      .pipe(z.array(z.uuid()).min(1).max(15))
      .optional(),
  })
  .strict();
export const historyQuerySchema = z
  .object({ range: historyRangeSchema.default('1D') })
  .strict();
export const assetSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  symbol: z.string(),
  name: z.string(),
  type: z.enum(['CRYPTO', 'STOCK']),
  exchange: z.string().nullable(),
  quoteCurrency: z.literal('USD'),
  isDemoOnly: z.boolean(),
});
export const dataStatusSchema = z.enum(['fresh', 'stale', 'unavailable']);
const provenance = (value: {
  provider: string;
  mode: string;
  simulated: boolean;
}) =>
  value.provider === 'DEMO'
    ? value.mode === 'DEMO' && value.simulated
    : value.mode === 'REAL' && !value.simulated;
export const HISTORY_SOURCE_MAX_AGE_MS = {
  '1D': 30 * 60_000,
  '7D': 6 * 3600_000,
  '1M': 6 * 3600_000,
  '1Y': 48 * 3600_000,
} as const;
export const quoteSchema = z
  .object({
    assetId: z.uuid(),
    provider: z.enum(['DEMO', 'COINGECKO']),
    mode: z.enum(['DEMO', 'REAL']),
    currency: z.literal('USD'),
    simulated: z.boolean(),
    status: dataStatusSchema,
    price: z.string().nullable(),
    changePercent: z.string().nullable(),
    sourceAt: z.iso.datetime().nullable(),
    fetchedAt: z.iso.datetime().nullable(),
    reason: z.string().nullable(),
  })
  .refine(provenance, 'Provider, mode and simulated flag must agree');
export const historyResponseSchema = z
  .object({
    assetId: z.uuid(),
    range: historyRangeSchema,
    provider: z.enum(['DEMO', 'COINGECKO']),
    mode: z.enum(['DEMO', 'REAL']),
    currency: z.literal('USD'),
    simulated: z.boolean(),
    status: dataStatusSchema,
    refresh: z.enum(['pending', 'idle']),
    granularity: z.enum(['5m', '1h', '1d']),
    fetchedAt: z.iso.datetime().nullable(),
    reason: z.string().nullable(),
    sourceAt: z.iso.datetime().nullable().optional(),
    freshUntil: z.iso.datetime().nullable().optional(),
    expiresAt: z.iso.datetime().nullable().optional(),
    points: z.array(
      z.object({ timestamp: z.iso.datetime(), price: z.string() }),
    ),
  })
  .refine(provenance, 'Provider, mode and simulated flag must agree');
export const marketProviderStatusSchema = z.object({
  provider: z.enum(['DEMO', 'COINGECKO']),
  enabled: z.boolean(),
  disabled: z.boolean(),
  lastError: z.string().nullable(),
  blockedUntil: z.iso.datetime().nullable(),
  lastSuccessAt: z.iso.datetime().nullable(),
  quoteReason: z.string().nullable().default(null),
  historyReason: z.string().nullable().default(null),
  budgets: z.array(
    z.object({
      category: z.string(),
      remaining: z.number().int().nonnegative(),
      resetsAt: z.iso.datetime(),
    }),
  ),
});
export const marketStatusSchema = z.object({
  cryptoMode: z.enum(['demo', 'coingecko']),
  stockMode: z.literal('demo'),
  refreshSeconds: z.object({
    crypto: z.number().positive(),
    stocks: z.number().positive(),
  }),
  workerEnabled: z.boolean(),
  alwaysOn: z.boolean().default(false),
  attribution: z.string(),
  providers: z.array(marketProviderStatusSchema).default([]),
});
export type MarketStatus = z.infer<typeof marketStatusSchema>;
export type MarketAsset = z.infer<typeof assetSchema>;
export type QuoteDto = z.infer<typeof quoteSchema>;
