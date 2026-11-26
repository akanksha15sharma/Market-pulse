import { Router } from 'express';
import { z } from 'zod';
import {
  notificationReadSchema,
  notificationReadAllSchema,
  notificationQuerySchema,
  notificationPreferencePatchSchema,
} from '@marketpulse/contracts';
import type { AuthConfig } from '../../config/env.js';
import type { AuthService } from '../auth/service.js';
import { digest, requireCsrf, sessionToken } from '../auth/security.js';
import type { NotificationService } from './service.js';

export function notificationRoutes(
  service: NotificationService,
  auth: AuthService,
  config: AuthConfig,
) {
  const router = Router();
  router.use(async (req, res, next) => {
    const user = await auth.me(sessionToken(req, config));
    res.locals.userId = user.id;
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (write) requireCsrf(req, config);
    await auth.limit(
      digest(`notifications:${write ? 'write' : 'read'}:${user.id}`),
      60,
      60_000,
    );
    if (req.method === 'GET' && req.path === '/')
      notificationQuerySchema.parse(req.query);
    else z.object({}).strict().parse(req.query);
    next();
  });
  router.get('/', async (req, res) =>
    res.json(await service.history(res.locals.userId as string, req.query)),
  );
  router.get('/summary', async (_req, res) =>
    res.json(await service.summary(res.locals.userId as string)),
  );
  router.get('/preferences', async (_req, res) =>
    res.json(await service.preferences(res.locals.userId as string)),
  );
  router.patch('/preferences', async (req, res) =>
    res.json(
      await service.patchPreferences(
        res.locals.userId as string,
        notificationPreferencePatchSchema.parse(req.body),
      ),
    ),
  );
  router.post('/read-all', async (req, res) => {
    notificationReadAllSchema.parse(req.body);
    res.json(await service.markAllRead(res.locals.userId as string));
  });
  router.patch('/:id/read', async (req, res) => {
    const { read } = notificationReadSchema.parse(req.body);
    res.json(
      await service.setRead(
        res.locals.userId as string,
        z.uuid().parse(req.params.id),
        read,
      ),
    );
  });
  return router;
}
