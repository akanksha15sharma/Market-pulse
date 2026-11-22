import 'dotenv/config';
import { z } from 'zod';
const bool = z.enum(['true', 'false']).transform((value) => value === 'true');
export const marketSettingsSchema = z.object({
  CRYPTO_DATA_MODE: z.enum(['demo', 'coinpaprika']).default('coinpaprika'),
  STOCK_DATA_MODE: z.literal('demo').default('demo'),
  MARKET_WORKER_ENABLED: bool.default(true),
  MARKET_ALWAYS_ON: bool.default(false),
  CP_MINUTE_ATTEMPT_LIMIT: z.coerce.number().int().min(1).max(10).default(10),
  CP_DAILY_ATTEMPT_LIMIT: z.coerce.number().int().min(1).max(260).default(260),
  CP_MONTHLY_ATTEMPT_LIMIT: z.coerce
    .number()
    .int()
    .min(1)
    .max(8000)
    .default(8000),
  CP_CHART_DAILY_LIMIT: z.coerce.number().int().min(1).max(80).default(80),
});
export type MarketSettings = z.infer<typeof marketSettingsSchema>;
export const marketSettings = marketSettingsSchema.parse(process.env);
