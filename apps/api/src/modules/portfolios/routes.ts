import {
  portfolioInputSchema,
  portfolioTransactionInputSchema,
} from '@marketpulse/contracts';
import { Router } from 'express';
import { z } from 'zod';
import type { AuthConfig } from '../../config/env.js';
import type { AuthService } from '../auth/service.js';
import { digest, requireCsrf, sessionToken } from '../auth/security.js';
import type { PortfolioService } from './service.js';

export function portfolioRoutes(
  service: PortfolioService,
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
    z.object({}).strict().parse(req.query);
    await auth.limit(
      digest(`portfolios:${write ? 'write' : 'read'}:${user.id}`),
      60,
      60_000,
    );
    next();
  });
  router.get('/', async (_req, res) =>
    res.json(await service.list(res.locals.userId as string)),
  );
  router.post('/', async (req, res) =>
    res.status(201).json({
      portfolio: await service.create(
        res.locals.userId as string,
        portfolioInputSchema.parse(req.body),
      ),
    }),
  );
  router.delete('/:id', async (req, res) => {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    await service.delete(
      res.locals.userId as string,
      z.uuid().parse(req.params.id),
    );
    res.status(204).end();
  });
  router.post('/:id/transactions', async (req, res) => {
    await service.addTransaction(
      res.locals.userId as string,
      z.uuid().parse(req.params.id),
      portfolioTransactionInputSchema.parse(req.body),
    );
    res.status(201).json({ saved: true });
  });
  router.delete('/:id/transactions/:transactionId', async (req, res) => {
    z.object({})
      .strict()
      .parse(req.body ?? {});
    await service.deleteTransaction(
      res.locals.userId as string,
      z.uuid().parse(req.params.id),
      z.uuid().parse(req.params.transactionId),
    );
    res.status(204).end();
  });
  return router;
}
