# MarketPulse

Live Crypto & Stock Tracker with Price Alerts — Phase 2 database foundation (verification pending).
No market, authentication, portfolio or alert features are implemented yet.
See [Phase 0 decisions](docs/README.md) for scope and data-mode limitations.

## Requirements

Node.js 22.12+ within Node 22 (use `nvm use`), npm 9+, Docker with Compose v2.

## Local setup

```sh
npm install
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
npm run db:up
npm run dev
```

Frontend: http://127.0.0.1:5173. API: http://127.0.0.1:3001/api/v1/health/live.
Vite proxies `/api` to Express, so the browser uses the same origin. Change
`API_PROXY_TARGET` if you change the API port. Environment files are optional for
Phase 1 defaults. Database credentials are local-only; keep custom root Compose
values and the API DATABASE_URL consistent. Prisma migrations and catalog seeding are described in [database setup](docs/database.md).
`npm run db:down` stops PostgreSQL while retaining the named data volume.

The root dev command builds shared contracts first, then watches contracts, API and
frontend together. Shared runtime exports live in `dist`, not TypeScript source.
A fresh clone requires the root build/dev command before standalone API startup.
The root command generates Prisma Client before starting the watchers.
The API uses Node 22 native watch mode with the existing `tsx` loader. It watches
imported API modules and shared contracts without the Unix IPC listener required
by the `tsx watch` CLI. Environment-file changes require a manual restart.

## Checks and production builds

```sh
npm run lint
npm run format:check
npm run typecheck
npm run build
npm run start -w @marketpulse/api
npm run preview -w @marketpulse/web
```

CI currently runs `npm install`. Once registry access is available, generate and commit
`package-lock.json`, then switch CI to `npm ci` with npm caching.
Build order is contracts, API, web.
Outputs: `packages/contracts/dist`, `apps/api/dist`, `apps/web/dist`.
Vite preview is only a local bundle preview: it does not proxy API requests. A
same-origin production server and SPA fallback will be added in deployment Phase 12.
The health endpoint reports process liveness only, not database readiness.
Use `npm run format` to format new work; approved Phase 0 docs are excluded to
preserve them unchanged. CI checks formatting, lint, types, builds and Compose startup.

## Structure

- `apps/web/src`: routing, layouts, pages and Tailwind styles.
- `apps/api/src`: Express application, server lifecycle and runtime configuration.
- `packages/contracts/src`: shared Zod schemas and inferred public types.
- `compose.yaml`: local PostgreSQL with health check and persistent volume.
- `docs`: approved Phase 0 planning; future feature folders arrive with their phases.

No provider keys are required. Never put secrets in frontend environment variables.

## Database development

See [database setup and relationships](docs/database.md) for migrations, seeding and
isolated PostgreSQL integration tests. Authentication tables exist, but there are no
Phase 3 handlers or auth endpoints. Provider quotes and user accounts are not seeded.
