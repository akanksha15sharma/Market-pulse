import { Router } from 'express';
import { z } from 'zod';
import {
  alertCreateSchema,
  alertTargetSchema,
  alertQuerySchema,
  alertEventQuerySchema,
} from '@marketpulse/contracts';
import type { AuthConfig } from '../../config/env.js';
import type { AuthService } from '../auth/service.js';
import { digest, requireCsrf, sessionToken } from '../auth/security.js';
import type { AlertService } from './service.js';
export function alertRoutes(
  service: AlertService,
  auth: AuthService,
  config: AuthConfig,
) {
  const router = Router();
  router.use(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const user = await auth.me(sessionToken(req, config));
    res.locals.userId = user.id;
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (write) {
      requireCsrf(req, config);
      z.object({}).strict().parse(req.query);
    }
    await auth.limit(
      digest(`alerts:${write ? 'write' : 'read'}:${user.id}`),
      60,
      60_000,
    );
    next();
  });
  router.get('/', async (req, res) =>
    res.json(
      await service.list(
        res.locals.userId as string,
        alertQuerySchema.parse(req.query),
      ),
    ),
  );
  router.post('/', async (req, res) =>
    res.status(201).json({
      alert: await service.create(
        res.locals.userId as string,
        alertCreateSchema.parse(req.body),
      ),
    }),
  );
  router.get('/:id/events', async (req, res) =>
    res.json(
      await service.events(
        res.locals.userId as string,
        z.uuid().parse(req.params.id),
        alertEventQuerySchema.parse(req.query),
      ),
    ),
  );
  router.get('/:id', async (req, res) => {
    z.object({}).strict().parse(req.query);
    res.json({
      alert: await service.get(
        res.locals.userId as string,
        z.uuid().parse(req.params.id),
      ),
    });
  });
  router.patch('/:id', async (req, res) =>
    res.json({
      alert: await service.edit(
        res.locals.userId as string,
        z.uuid().parse(req.params.id),
        alertTargetSchema.parse(req.body),
      ),
    }),
  );
  for (const action of ['pause', 'rearm'] as const)
    router.post(`/:id/${action}`, async (req, res) => {
      z.object({})
        .strict()
        .parse(req.body ?? {});
      res.json({
        alert: await service[action](
          res.locals.userId as string,
          z.uuid().parse(req.params.id),
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
  return router;
}
