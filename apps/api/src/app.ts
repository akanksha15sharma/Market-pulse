import express from 'express';
import { healthResponseSchema } from '@marketpulse/contracts';

export const app = express();
app.disable('x-powered-by');
app.get('/api/v1/health/live', (_req, res) => {
  res.json(
    healthResponseSchema.parse({ status: 'ok', service: 'marketpulse-api' }),
  );
});
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});
