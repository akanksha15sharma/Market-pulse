import 'dotenv/config';
import { z } from 'zod';
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
export const marketSettingsSchema = z
  .object({
    CRYPTO_DATA_MODE: z.enum(['demo', 'coingecko']).default('demo'),
    STOCK_DATA_MODE: z.literal('demo').default('demo'),
    MARKET_WORKER_ENABLED: bool.default(true),
    MARKET_ALWAYS_ON: bool.default(false),
    COINGECKO_LIVE_ENABLED: bool.default(false),
    COINGECKO_API_KEY: z.string().min(1).optional(),
    CG_BILLING_START: z.iso.datetime().optional(),
    CG_BILLING_END: z.iso.datetime().optional(),
    CG_MINUTE_ATTEMPT_LIMIT: z.coerce.number().int().min(1).max(10).default(10),
    CG_DAILY_ATTEMPT_LIMIT: z.coerce
      .number()
      .int()
      .min(1)
      .max(260)
      .default(260),
    CG_MONTHLY_ATTEMPT_LIMIT: z.coerce
      .number()
      .int()
      .min(1)
      .max(8000)
      .default(8000),
    CG_CHART_DAILY_LIMIT: z.coerce.number().int().min(1).max(80).default(80),
  })
  .superRefine((value, context) => {
    if (
      value.COINGECKO_LIVE_ENABLED &&
      (!value.COINGECKO_API_KEY ||
        !value.CG_BILLING_START ||
        !value.CG_BILLING_END ||
        Date.parse(value.CG_BILLING_END) <= Date.parse(value.CG_BILLING_START))
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Live CoinGecko requires a key and an explicit valid billing window',
      });
    }
  });
export type MarketSettings = z.infer<typeof marketSettingsSchema>;
export const marketSettings = marketSettingsSchema.parse(process.env);
