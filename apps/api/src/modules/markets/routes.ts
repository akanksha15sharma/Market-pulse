import { Router } from 'express';
import { z } from 'zod';
import {
  assetQuerySchema,
  historyQuerySchema,
  quoteQuerySchema,
} from '@marketpulse/contracts';
import type { AuthService } from '../auth/service.js';
import type { AuthConfig } from '../../config/env.js';
import { digest, sessionToken } from '../auth/security.js';
import type { MarketService } from './service.js';

export function marketRoutes(
  market: MarketService,
  auth: AuthService,
  config: AuthConfig,
) {
  const router = Router();
  router.use(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    await auth.limit(digest(`market-read:${req.ip}`), 60, 60_000);
    next();
  });
  router.get('/assets', async (req, res) => {
    res.json(await market.list(assetQuerySchema.parse(req.query)));
  });
  router.get('/assets/:id', async (req, res) => {
    res.json({ asset: await market.detail(z.uuid().parse(req.params.id)) });
  });
  router.get('/quotes', async (req, res) => {
    res.json(await market.quotes(quoteQuerySchema.parse(req.query).assetIds));
  });
  router.get('/assets/:id/history', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const { range } = historyQuerySchema.parse(req.query);
    const raw = sessionToken(req, config);
    const identity = raw ? (await auth.me(raw)).id : req.ip;
    await auth.limit(digest(`market-history:${identity}`), 6, 60_000);
    const result = await market.history(id, range);
    res.status(result.status).json(result.body);
  });
  router.get('/market-status', async (_req, res) => {
    res.json(await market.status());
  });
  return router;
}
