import { Router } from 'express';
import { z } from 'zod';
import {
  watchlistInputSchema,
  watchlistItemInputSchema,
} from '@marketpulse/contracts';
import type { AuthConfig } from '../../config/env.js';
import type { AuthService } from '../auth/service.js';
import { digest, requireCsrf, sessionToken } from '../auth/security.js';
import type { WatchlistService } from './service.js';

export function watchlistRoutes(
  service: WatchlistService,
  auth: AuthService,
  config: AuthConfig,
) {
  const router = Router();
  router.use(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const user = await auth.me(sessionToken(req, config));
    res.locals.userId = user.id;
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (write) requireCsrf(req, config);
    await auth.limit(
      digest(`watchlists:${write ? 'write' : 'read'}:${user.id}`),
      60,
      60_000,
    );
    z.object({}).strict().parse(req.query);
    next();
  });
  router.get('/', async (_req, res) => {
    res.json({ watchlists: await service.list(res.locals.userId as string) });
  });
  router.post('/', async (req, res) => {
    const list = await service.create(
      res.locals.userId as string,
      watchlistInputSchema.parse(req.body),
    );
    res.status(201).json({ watchlist: list });
  });
  router.get('/:id', async (req, res) => {
    res.json({
      watchlist: await service.get(
        res.locals.userId as string,
        z.uuid().parse(req.params.id),
      ),
    });
  });
  router.patch('/:id', async (req, res) => {
    res.json({
      watchlist: await service.rename(
        res.locals.userId as string,
        z.uuid().parse(req.params.id),
        watchlistInputSchema.parse(req.body),
      ),
    });
  });
  router.delete('/:id', async (req, res) => {
    await service.delete(
      res.locals.userId as string,
      z.uuid().parse(req.params.id),
    );
    res.status(204).end();
  });
  router.post('/:id/items', async (req, res) => {
    const { assetId } = watchlistItemInputSchema.parse(req.body);
    res.json({
      watchlist: await service.add(
        res.locals.userId as string,
        z.uuid().parse(req.params.id),
        assetId,
      ),
    });
  });
  router.delete('/:id/items/:assetId', async (req, res) => {
    await service.remove(
      res.locals.userId as string,
      z.uuid().parse(req.params.id),
      z.uuid().parse(req.params.assetId),
    );
    res.status(204).end();
  });
  return router;
}
