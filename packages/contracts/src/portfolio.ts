import { z } from 'zod';
import { assetSchema } from './markets.js';

export const PORTFOLIO_LIMITS = { portfolios: 10, transactions: 500 } as const;
export const portfolioNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (name) =>
      Array.from(name).every((character) => character.charCodeAt(0) >= 32),
    'Use a name without control characters',
  );
const decimalPattern = /^(?:0|[1-9]\d{0,19})(?:\.\d{1,18})?$/;
const signedAmountPattern = /^-?(?:0|[1-9]\d{0,37})(?:\.\d{1,18})?$/;
export const portfolioPositiveDecimalSchema = z
  .string()
  .trim()
  .regex(
    decimalPattern,
    'Use a positive decimal with at most 18 fractional digits',
  )
  .refine((value) => /[1-9]/.test(value), 'Value must be greater than zero');
export const portfolioFeeSchema = z
  .string()
  .trim()
  .regex(
    decimalPattern,
    'Use a non-negative decimal with at most 18 fractional digits',
  );
const portfolioSignedAmountSchema = z
  .string()
  .regex(signedAmountPattern, 'Invalid calculated amount');
export const portfolioInputSchema = z
  .object({ name: portfolioNameSchema })
  .strict();
export const portfolioTransactionInputSchema = z
  .object({
    assetId: z.uuid(),
    side: z.enum(['BUY', 'SELL']),
    quantity: portfolioPositiveDecimalSchema,
    unitPrice: portfolioPositiveDecimalSchema,
    fee: portfolioFeeSchema.default('0'),
    executedAt: z.iso.datetime(),
  })
  .strict();
export const portfolioTransactionSchema = z.object({
  id: z.uuid(),
  asset: assetSchema,
  side: z.enum(['BUY', 'SELL']),
  quantity: portfolioPositiveDecimalSchema,
  unitPrice: portfolioPositiveDecimalSchema,
  fee: portfolioFeeSchema,
  executedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export const portfolioPositionSchema = z.object({
  asset: assetSchema,
  quantity: portfolioFeeSchema,
  investedAmount: portfolioFeeSchema,
  marketValue: portfolioFeeSchema.nullable(),
  realizedReturn: portfolioSignedAmountSchema.nullable(),
  totalReturn: portfolioSignedAmountSchema.nullable(),
  returnPercent: portfolioSignedAmountSchema.nullable(),
  price: portfolioFeeSchema.nullable(),
  priceSource: z.string().nullable(),
  priceObservedAt: z.iso.datetime().nullable(),
});
export const portfolioSchema = z.object({
  id: z.uuid(),
  name: portfolioNameSchema,
  baseCurrency: z.literal('USD'),
  createdAt: z.iso.datetime(),
  investedAmount: portfolioFeeSchema,
  marketValue: portfolioFeeSchema.nullable(),
  realizedReturn: portfolioSignedAmountSchema.nullable(),
  totalReturn: portfolioSignedAmountSchema.nullable(),
  returnPercent: portfolioSignedAmountSchema.nullable(),
  valuationAvailable: z.boolean(),
  positions: z.array(portfolioPositionSchema),
  transactions: z.array(portfolioTransactionSchema),
});
export const portfoliosResponseSchema = z.object({
  portfolios: z.array(portfolioSchema),
});
export type PortfolioView = z.infer<typeof portfolioSchema>;
