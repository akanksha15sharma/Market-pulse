# Deployment runbook

This runbook describes the implemented application as reviewed on 2026-11-23.
No hosting resources have been provisioned, migrations applied, or deployment
performed during production preparation. Hosting-specific values must be selected
before release; no free-tier capacity, pricing, or continuous service is assumed.

For a researched Vercel/Render/Neon personal-demo profile and optional bounded
background batches, see the [free deployment plan](free-deployment.md). That plan
preserves the existing continuous worker for other hosting choices.

## Topology

Use one public HTTPS origin with two upstreams:

| Public request            | Destination                                                                |
| ------------------------- | -------------------------------------------------------------------------- |
| `/api/*`                  | Express API, preserving the full path, cookies, request bodies, and Origin |
| Existing static files     | Files in `apps/web/dist`                                                   |
| Other frontend GET routes | `apps/web/dist/index.html` SPA fallback                                    |

The API serves JSON only. An unknown API route must remain a JSON 404 rather than
falling through to `index.html`. SPA fallback is required for `/assets/:id`,
`/watchlists`, `/alerts`, and account links opened directly or refreshed.
Vite's development proxy is absent from the build. Do not use `vite preview` as a
production server. [Vite static deployment documentation](https://vite.dev/guide/static-deploy.html).

Use separate processes for the API and any standalone worker. The default API
worker runs on demand, stopping approximately ten minutes after catalog activity
ends. An API configured with `MARKET_ALWAYS_ON=true` still initializes its market
runtime on the first market request; use the standalone worker when background
startup independent of visitors is required. Persisted leases coordinate workers.

## Environment

Set hosted values in the runtime/release secret store. Root `.env` is for local
Compose; workspace dotenv files are optional local convenience, not release
artifacts. Production commands below run from the repository root and forward to
the API workspace. Build from the repository root, including shared contracts.

| Variable                   | Default / production requirement                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                 | `development`; set `production` for hosted API and preflight                                                                 |
| `HOST`                     | `127.0.0.1`; use `0.0.0.0` if the host requires an exposed container listener                                                |
| `PORT`                     | `3001`; accepts the host-provided port, integer 1–65535                                                                      |
| `APP_ORIGIN`               | `http://127.0.0.1:5173`; production requires the exact public HTTPS origin, no path, credentials, query, or trailing slash   |
| `CSRF_SECRET`              | Temporary in development; production requires a stable secret of at least 64 characters, shared across API replicas          |
| `TRUSTED_PROXIES`          | Empty: trust no forwarded IPs. Comma-separated proxy IPs/CIDRs; invalid entries, booleans, hop counts, and `/0` are rejected |
| `DATABASE_URL`             | Required for production preflight/database operations; PostgreSQL runtime connection, optionally pooled                      |
| `DIRECT_DATABASE_URL`      | Optional direct/unpooled migration connection; Prisma CLI falls back to `DATABASE_URL`                                       |
| `SESSION_TTL_SECONDS`      | `604800`; permitted range 60–604800                                                                                          |
| `EMAIL_MODE`               | `disabled`; production permits disabled delivery only. `mailpit` is rejected in production                                   |
| `MAILPIT_URL`              | `http://127.0.0.1:8025`; local-only when enabled                                                                             |
| `CRYPTO_DATA_MODE`         | `coinpaprika`; `demo` is available for offline demonstrations                                                                |
| `STOCK_DATA_MODE`          | `demo` only                                                                                                                  |
| `MARKET_WORKER_ENABLED`    | `true`; `false` disables ingestion and alert evaluation in that process                                                      |
| `MARKET_ALWAYS_ON`         | `false`; standalone worker requires `true` and worker enabled                                                                |
| `CP_MINUTE_ATTEMPT_LIMIT`  | `10`, allowed 1–10                                                                                                           |
| `CP_DAILY_ATTEMPT_LIMIT`   | `260`, allowed 1–260                                                                                                         |
| `CP_MONTHLY_ATTEMPT_LIMIT` | `8000`, allowed 1–8000                                                                                                       |
| `CP_CHART_DAILY_LIMIT`     | `80`, allowed 1–80                                                                                                           |
| `TEST_DATABASE_URL`        | Test-only: dedicated local `marketpulse_test`; never point tests at production                                               |
| `API_PROXY_TARGET`         | Web development only; defaults to `http://127.0.0.1:3001`                                                                    |

Boolean market settings accept literal `true` or `false`. CoinPaprika needs no API
key in this implementation. Legacy CoinGecko/Twelve Data keys, `CG_*`, `DB_POOL_MAX`,
`LOG_LEVEL`, and hosted email settings are not implemented configuration controls.
Never put secrets in `VITE_*` variables; they can be bundled into public JavaScript.

Generate a fresh CSRF secret in a secure terminal and store it in the host secret
store, never in committed files:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Use the database provider's verified TLS connection settings/CA and separate
least-privileged runtime and migration credentials where supported. The seed uses
`DATABASE_URL`, while migration commands prefer `DIRECT_DATABASE_URL`; give the
release job catalog-write privileges for seeding and keep its credentials separate
from the running service when using restricted roles. Do not disable
certificate verification. The runtime pool is capped at five connections per
process; connection acquisition times out after five seconds and queries after
ten seconds. Count API replicas and workers when budgeting database connections.
The preflight validates URL structure, not TLS negotiation or privileges.

### Reverse proxy and security

Configure `TRUSTED_PROXIES` only after identifying the actual proxy source IPs or
CIDRs. The API should be reachable only through that proxy. For a proxy on the
same host, an explicit loopback IP may be appropriate; do not copy that setting to
an unrelated topology. The edge must sanitize forwarded headers. Express checks
the chain from the closest peer outward; leaving trust empty behind a proxy makes
clients share that proxy's IP rate limit.
[Express proxy documentation](https://expressjs.com/en/guide/behind-proxies/).

Production API cookies use `__Host-` names, Secure, HttpOnly, SameSite=Strict, and
Path=/, with no Domain attribute. The API enforces exact origins for writes,
signed session-bound CSRF, input size/shape limits, HSTS, no-store, nosniff,
request IDs, and a JSON-only Content-Security-Policy.

Configure frontend security headers separately at the static host. Its policy
must allow the SPA's same-origin scripts/styles and API connections. Do not apply
the API's `default-src 'none'` policy to the HTML page. Disable framing and MIME
sniffing and enforce HTTPS there as well. Cache existing hashed JS/CSS files as
immutable; revalidate HTML, including deep-link fallback responses. An asset
**detail route** such as `/assets/<uuid>` is HTML, not a hashed static asset.
Do not cache API responses or cookies at a CDN.

Authentication's scrypt parameters are deliberately memory-intensive, with at
most two concurrent derivations per API process. Budget and load-test memory for
two concurrent logins plus the server; do not assume a tiny host allocation can
handle it. Additional login attempts can receive a recoverable 503.

## Build and read-only preflight

Use Node 22.12+ within Node 22 and the committed lockfile. Install build/release
tools even if the platform sets `NODE_ENV=production` during installation:

```sh
npm ci --include=dev
npm run db:validate
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm run production:check
```

`production:check` runs the compiled checker, so build first. It validates runtime
and market configuration, including PostgreSQL URL structure. Its error output
omits environment values. It starts no server or worker, opens no connection,
performs no migration, and calls no external provider. It does not prove that the
database is reachable or correctly migrated. Review `npm audit --omit=dev` before
release; never accept a forced major-version change without compatibility review.

The root package manifest narrowly overrides `effect` under `@prisma/config` to
`3.22.1` for [GHSA-7589-6fvf-x4pw](https://github.com/advisories/GHSA-7589-6fvf-x4pw).
Prisma CLI/client/adapter remain pinned to `7.10.1`. Retain the override until an
upstream Prisma update includes a patched dependency; review it alongside Prisma
schema generation/validation and tests when upgrading.

Artifacts are `apps/web/dist`, `apps/api/dist`, and `packages/contracts/dist`.
The compiled API still resolves workspace packages and runtime dependencies: keep
the workspace layout and package manifests when packaging. A release job also
needs the Prisma CLI and `tsx` for the explicit seed; do not omit development
dependencies from that job. No start or build script automatically migrates data.

## Database release procedure — approval required

Do not run this section against a real environment without release approval.

1. Confirm the intended database, reviewed release commit, backup retention, and
   a tested restore procedure. Use the direct connection for migrations. Check
   database reachability and credentials through the hosting platform without
   pasting connection strings into logs.
2. Review the six committed migrations in order: initial schema, auth rate limits,
   history/cache changes, CoinPaprika enum, CoinPaprika mappings, and alert-event
   provenance. Do not edit applied migrations. The provider enum and mapping
   migrations are intentionally separate so the new enum value commits first.
   The historical primary-key replacement can acquire locks; plan an appropriate
   release window for an existing database.
3. Run one serialized release job with the correct environment:

   ```sh
   npm run db:deploy
   npm run db:status
   npm run db:seed
   ```

   `db:deploy` wraps Prisma 7 `migrate deploy`. Do not use `db:migrate`, `migrate
reset`, or `db push` in production. The seed transaction upserts the curated
   catalog and provider mappings; it creates no users, credentials, or prices.
   Seed after migrations on a fresh database; mapping migrations only update
   assets that already exist. [Prisma 7 production migration documentation](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/development-and-production).

4. Stop the rollout if migration status or seeding fails. Investigate rather than
   automatically marking migrations resolved or resetting the database. For an
   existing database, test the upgrade and schema drift on a restored staging
   copy before release. `migrate deploy` alone does not detect schema drift.
5. Start the API with `npm start`, which runs the offline production preflight,
   then `node dist/server.js` in the API workspace. Serve the frontend and route
   its API requests through the configured public origin.

No migration changes were required by this preparation. Database execution is
separate from schema validation and still requires verification on the target.

## Health and release verification

| Probe                      | Meaning                                             |
| -------------------------- | --------------------------------------------------- |
| `GET /api/v1/health/live`  | Process responds; independent of PostgreSQL         |
| `GET /api/v1/health/ready` | `SELECT 1` succeeds; otherwise 503 with Retry-After |

Use readiness for admission/load balancing, and liveness for process restarts.
Probe through the trusted infrastructure and set suitable host timeouts. Readiness
confirms connectivity only; it does not validate migrations, seed data, provider
availability, worker progress, or end-user flows. After an approved release:

- Open frontend deep links directly and verify HTML fallback and noncached API 404s.
- Register a synthetic account, sign in/out, revoke a session, and check secure
  cookies, exact-origin rejection, and independent client rate limits behind the proxy.
- Verify browser favorites survive refresh and private watchlists remain owner-scoped.
- Check real crypto provenance, simulated stocks, all four chart ranges, and
  unavailable history without synthetic substitution. Inspect source timestamps.
- Verify alert eligibility and target-reached history with fresh real observations.
  Monitor provider budgets and worker error messages; missing data is an explicit
  degraded state rather than a deployment success signal.

## Workers, account recovery, and operations

For continuous background ingestion, use an always-on worker with the same database,
market modes, and quota limits, and set both worker flags to true:

```sh
npm run start:worker
```

A separate API can set `MARKET_WORKER_ENABLED=false` when a dedicated worker owns
scheduling. The standalone process requires `MARKET_ALWAYS_ON=true` and
`MARKET_WORKER_ENABLED=true`; it refuses to start otherwise. Each process has its
own connection pool. Worker leases and budgets are persisted, but a sleeping host
still misses observations; no downtime crossings are invented. The API handles
SIGINT/SIGTERM with a ten-second shutdown deadline. Allow a suitable shutdown grace
period for standalone workers and monitor termination failures.

Production email is unavailable: reset/verification delivery and alert email are
not supported by a hosted sender. Do not promise self-service account recovery or
email alerts; decide this limitation explicitly before a public account launch.
Mailpit remains local-only. There is no production SMTP/Resend configuration yet.

Monitor readiness, error/request IDs, response latency, database capacity, provider
budgets, source freshness, and worker failures. Keep secrets, cookies, password
hashes, and raw exception details out of logs. Retain database backups independently
of application disks and test restores. Roll back application code only when it
is compatible with the current schema; use reviewed forward migrations for schema
repairs. No destructive down-migration or automatic database reset is provided.
