import { Router } from 'express';
import { z } from 'zod';
import {
  emailRequestSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@marketpulse/contracts';
import type { AuthConfig } from '../../config/env.js';
import type { AuthService } from './service.js';
import {
  clearSession,
  digest,
  issueCsrf,
  requireCsrf,
  sessionToken,
  writeSession,
} from './security.js';

export function authRoutes(auth: AuthService, config: AuthConfig) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/csrf', (req, res) => {
    res.json({ csrfToken: issueCsrf(req, res, config) });
  });
  router.use(async (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      requireCsrf(req, config);
      const key = digest(`ip:${req.ip}:${req.path}`);
      await auth.limit(key, 30, 15 * 60_000);
    }
    next();
  });
  router.post('/register', async (req, res) => {
    const input = registerSchema.parse(req.body);
    await auth.limit(digest(`register:${input.email}`), 5, 60 * 60_000);
    const result = await auth.register(input, sessionToken(req, config));
    writeSession(res, result.token, config);
    res.status(201).json({ user: result.user });
  });
  router.post('/login', async (req, res) => {
    const input = loginSchema.parse(req.body);
    await auth.limit(digest(`login:${input.email}`), 8, 15 * 60_000);
    const result = await auth.login(input, sessionToken(req, config));
    writeSession(res, result.token, config);
    res.json({ user: result.user });
  });
  router.post('/logout', async (req, res) => {
    await auth.logout(sessionToken(req, config));
    clearSession(res, config);
    res.status(204).end();
  });
  router.get('/me', async (req, res) => {
    res.json({ user: await auth.me(sessionToken(req, config)) });
  });
  router.get('/sessions', async (req, res) => {
    res.json({ sessions: await auth.sessions(sessionToken(req, config)) });
  });
  router.delete('/sessions/:id', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    if (await auth.revoke(sessionToken(req, config), id))
      clearSession(res, config);
    res.status(204).end();
  });
  router.post('/forgot-password', async (req, res) => {
    const { email } = emailRequestSchema.parse(req.body);
    await auth.limit(digest(`recovery:${email}`), 3, 60 * 60_000);
    await auth.requestReset(email);
    res.json({ message: 'If the account exists, a reset email will be sent.' });
  });
  router.post('/resend-verification', async (req, res) => {
    const raw = sessionToken(req, config);
    await auth.limit(digest(`verification:${raw ?? req.ip}`), 3, 60 * 60_000);
    await auth.resend(raw);
    res.json({ message: 'Verification email requested.' });
  });
  router.post('/verify-email', async (req, res) => {
    await auth.verify(verifyEmailSchema.parse(req.body).token);
    res.json({ message: 'Email verified.' });
  });
  router.post('/reset-password', async (req, res) => {
    await auth.reset(resetPasswordSchema.parse(req.body));
    clearSession(res, config);
    res.json({ message: 'Password reset. Sign in again.' });
  });
  return router;
}
