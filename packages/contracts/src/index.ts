import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('marketpulse-api'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export * from './auth.js';
export * from './markets.js';
export * from './watchlists.js';
export * from './alerts.js';

export * from './market-capabilities.js';
