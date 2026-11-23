import express from 'express';
import { alertRoutes } from './modules/alerts/routes.js';
import {
  createAlertService,
  type AlertService,
} from './modules/alerts/service.js';
import { watchlistRoutes } from './modules/watchlists/routes.js';
import {
  createWatchlistService,
  type WatchlistService,
} from './modules/watchlists/service.js';
import type { ErrorRequestHandler } from 'express';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { healthResponseSchema } from '@marketpulse/contracts';
import { authConfig, env, type AuthConfig } from './config/env.js';
import { HttpError } from './lib/http-error.js';
import { authRoutes } from './modules/auth/routes.js';
import { sessionToken } from './modules/auth/security.js';
import { createAuthService, type AuthService } from './modules/auth/service.js';
import { getDatabaseClient } from './db/client.js';
import { marketRoutes } from './modules/markets/routes.js';
import { createMarketRuntime } from './modules/markets/runtime.js';
import type { MarketService } from './modules/markets/service.js';
import { authMailer } from './email/auth-mailer.js';

export function createApp(
  auth: AuthService,
  config: AuthConfig,
  market?: MarketService,
  watchlists?: WatchlistService,
  alerts?: AlertService,
  options: { trustedProxies?: string[]; readiness?: () => Promise<void> } = {},
) {
  const app = express();
  app.disable('x-powered-by');
  // Trust only the configured proxy addresses; never enable blanket header trust.
  app.set(
    'trust proxy',
    options.trustedProxies?.length ? options.trustedProxies : false,
  );
  app.use((req, res, next) => {
    res.set({
      'X-Request-ID': randomUUID(),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    });
    if (config.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
    if (
      (req.get('origin') && req.get('origin') !== config.origin) ||
      req.get('sec-fetch-site') === 'cross-site' ||
      (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        req.get('origin') !== config.origin)
    )
      return next(new HttpError(403, 'Request origin is not allowed'));
    next();
  });
  app.use(express.json({ limit: '16kb', type: 'application/json' }));
  app.get('/api/v1/health/live', (_req, res) => {
    res.json(
      healthResponseSchema.parse({ status: 'ok', service: 'marketpulse-api' }),
    );
  });
  app.get('/api/v1/health/ready', async (_req, res) => {
    try {
      if (!options.readiness) throw new Error('Readiness is not configured');
      await options.readiness();
      res.json({ status: 'ok', service: 'marketpulse-api' });
    } catch {
      res.set('Retry-After', '30');
      res
        .status(503)
        .json({ status: 'unavailable', service: 'marketpulse-api' });
    }
  });
  app.use('/api/v1/auth', authRoutes(auth, config));
  if (watchlists)
    app.use('/api/v1/watchlists', watchlistRoutes(watchlists, auth, config));
  if (alerts) app.use('/api/v1/alerts', alertRoutes(alerts, auth, config));
  if (market) app.use('/api/v1', marketRoutes(market, auth, config));
  app.get('/api/v1/private/profile', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({
      user: await auth.me(sessionToken(req, config)),
      message: 'Authenticated MarketPulse account',
    });
  });
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  const errors: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    void _next;
    if (error instanceof ZodError) {
      res
        .status(400)
        .json({ error: 'Invalid input', fields: error.flatten().fieldErrors });
      return;
    }
    if (error instanceof HttpError) {
      if (error.status === 429)
        res.set('Retry-After', String(error.retryAfter ?? 3600));
      if (error.status === 503) res.set('Retry-After', '30');
      res.status(error.status).json({ error: error.message });
      return;
    }
    const status =
      error && typeof error === 'object' && 'status' in error
        ? Number(error.status)
        : 500;
    res.status(status === 413 ? 413 : status === 400 ? 400 : 500).json({
      error:
        status === 413
          ? 'Request too large'
          : status === 400
            ? 'Invalid JSON'
            : 'Request failed',
      requestId: res.getHeader('X-Request-ID'),
    });
    // Never log bodies, cookies, database URLs or raw exception messages here.
  };
  app.use(errors);
  return app;
}
// Lazy initialization keeps process liveness independent of DATABASE_URL or PostgreSQL.
let service: AuthService | undefined;
const lazyAuth = new Proxy({} as AuthService, {
  get(_target, key: keyof AuthService) {
    service ??= createAuthService(getDatabaseClient(), authConfig, authMailer);
    return service[key];
  },
});
let marketRuntime: ReturnType<typeof createMarketRuntime> | undefined;
const lazyMarket = new Proxy({} as MarketService, {
  get(_target, key: keyof MarketService) {
    marketRuntime ??= createMarketRuntime(getDatabaseClient());
    return marketRuntime.service[key];
  },
});
export async function stopMarketWorker() {
  await marketRuntime?.stop();
}
let watchlistService: WatchlistService | undefined;
const lazyWatchlists = new Proxy({} as WatchlistService, {
  get(_target, key: keyof WatchlistService) {
    watchlistService ??= createWatchlistService(getDatabaseClient());
    return watchlistService[key];
  },
});
let alertService: AlertService | undefined;
const lazyAlerts = new Proxy({} as AlertService, {
  get(_target, key: keyof AlertService) {
    alertService ??= createAlertService(getDatabaseClient());
    return alertService[key];
  },
});
export const app = createApp(
  lazyAuth,
  authConfig,
  lazyMarket,
  lazyWatchlists,
  lazyAlerts,
  {
    trustedProxies: env.TRUSTED_PROXIES,
    readiness: async () => {
      await getDatabaseClient().$queryRaw`SELECT 1`;
    },
  },
);
