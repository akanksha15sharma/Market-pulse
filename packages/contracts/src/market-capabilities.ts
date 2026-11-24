import { z } from 'zod';

// Public feature availability is separate from legacy development provider modes.
export const publicMarketCapabilitiesSchema = z.object({
  displayProvider: z.literal('TRADINGVIEW'),
  nativePrices: z.literal(false),
  nativeHistory: z.literal(false),
  nativePriceAlerts: z.literal(false),
  reason: z.literal('authorized_native_source_required'),
});
export const publicMarketCapabilities = publicMarketCapabilitiesSchema.parse({
  displayProvider: 'TRADINGVIEW',
  nativePrices: false,
  nativeHistory: false,
  nativePriceAlerts: false,
  reason: 'authorized_native_source_required',
});
