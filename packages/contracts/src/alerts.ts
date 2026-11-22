import { z } from 'zod';
import { assetSchema } from './markets.js';
export const ALERT_ACTIVE_LIMIT = 10;
export const ALERT_MAX_AGE_MS = 20 * 60_000;
export const alertDirectionSchema = z.enum(['ABOVE', 'BELOW']);
export const alertStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'TRIGGERED']);
export const alertThresholdSchema = z
  .string()
  .trim()
  .regex(
    /^(?:0|[1-9]\d{0,19})(?:\.\d{1,18})?$/,
    'Use a positive USD decimal with at most 18 fractional digits',
  )
  .refine((value) => /[1-9]/.test(value), 'Target must be greater than zero');
export const alertTargetSchema = z
  .object({ direction: alertDirectionSchema, threshold: alertThresholdSchema })
  .strict();
export const alertCreateSchema = alertTargetSchema.extend({
  assetId: z.uuid(),
});
export const alertQuerySchema = z
  .object({
    status: alertStatusSchema.optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export const alertEventQuerySchema = alertQuerySchema.omit({ status: true });
export const alertEventSchema = z.object({
  id: z.uuid(),
  activation: z.number().int().positive(),
  observedPrice: z.string(),
  sourceAt: z.iso.datetime(),
  fetchedAt: z.iso.datetime().nullable(),
  triggeredAt: z.iso.datetime(),
  targetPrice: z.string().nullable(),
  direction: alertDirectionSchema.nullable(),
  provider: z.string().nullable(),
  mode: z.enum(['REAL', 'DEMO']).nullable(),
  verifiedReal: z.boolean(),
});
export const alertSchema = z.object({
  id: z.uuid(),
  asset: assetSchema,
  provider: z.enum(['COINPAPRIKA', 'DEMO', 'COINGECKO', 'TWELVE_DATA']),
  mode: z.enum(['REAL', 'DEMO']),
  currency: z.literal('USD'),
  direction: alertDirectionSchema,
  threshold: z.string(),
  status: alertStatusSchema,
  activation: z.number().int().positive(),
  armedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  eligibility: z.enum([
    'real_data_required',
    'real_crypto_disabled',
    'inactive_asset',
    'unsupported_source',
    'eligible',
  ]),
  latestEvent: alertEventSchema.nullable(),
});
export const alertsResponseSchema = z.object({
  alerts: z.array(alertSchema),
  total: z.number().int().nonnegative(),
  page: z.number(),
  limit: z.number(),
  activeCount: z.number().int().nonnegative(),
});
export const alertEventsResponseSchema = z.object({
  events: z.array(alertEventSchema),
  total: z.number().int().nonnegative(),
  page: z.number(),
  limit: z.number(),
});
export type AlertView = z.infer<typeof alertSchema>;
export type AlertEventView = z.infer<typeof alertEventSchema>;
