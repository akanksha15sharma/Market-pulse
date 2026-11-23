# MarketPulse

A responsive cryptocurrency and stock market tracker built with React 19, TypeScript,
Vite, Express 5, Prisma 7, and PostgreSQL 17. Prices are in USD. This is a portfolio
project, with explicit source, freshness, and simulation labels throughout.

## Features

- **Markets:** 10 curated cryptocurrencies and 5 stocks, price cards, search, type
  filters, and sorting. Star favorites and filter them; favorites stay in this
  browser through refreshes using localStorage.
- **Asset details:** catalog information and interactive historical charts with
  pointer exploration, a keyboard slider, exact-value tables, range statistics,
  and **24H, 7D, 30D, 1Y** filters.
- **Private watchlists:** create, rename, and delete up to five account-owned lists,
  with up to 20 assets each. Saved in PostgreSQL, separate from browser favorites.
- **Price alerts:** private USD targets, pause/rearm controls, and target-reached
  history. Only fresh, post-arm real CoinPaprika observations can trigger them.
  Stock targets remain blocked while stocks are simulated.
- **Accounts:** registration, sign-in, session revocation, signed CSRF tokens,
  password hashing, validation, ownership checks, and persistent rate limits.
- **Reliable data presentation:** cached observations remain visible during refresh
  failures; loading, pending, stale, unavailable, real, and simulated states are
  labeled. Keyboard navigation and responsive table scrolling are supported.

CoinPaprika is the active, keyless crypto provider and the default mode. Stocks
always use simulated data. Historical availability depends on the provider: a
missing real series stays unavailable, with no simulated replacement. Browser
prices refresh every 60 seconds while visible; provider refreshes are separately
budgeted. See [market data](docs/live-crypto.md).

Production account email delivery is **not implemented**. Local verification and
password-reset emails use Mailpit; hosted email must remain disabled. Alerts are
in-app records, with no production email notifications or continuous-availability
guarantee. Portfolios and trade execution are not implemented.

## Project layout

| Location                   | Purpose                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `apps/web`                 | React SPA, market pages, accounts, watchlists, alerts, web tests |
| `apps/api`                 | Express API, bounded market worker, Prisma schema and migrations |
| `packages/contracts`       | Shared Zod validation and TypeScript API contracts               |
| `scripts`                  | Development process supervision and web test runner              |
| `.github/workflows/ci.yml` | Builds, checks, migrations, seeding, isolated database tests     |
| `docs`                     | Deployment, database, feature, and architecture documentation    |

## Local setup

Use Node **22.12 or later within Node 22** (`.nvmrc` selects 22), npm 9 or later,
and Docker with Compose. Run these commands from the project root. If Node is
managed with nvm, run `nvm use` first.

```sh
npm ci
```

Create environment files only if they do not already exist; preserve existing
credentials and settings:

```sh
cp -n .env.example .env
cp -n apps/api/.env.example apps/api/.env
```

The root `.env` configures local Compose credentials and the PostgreSQL port.
`apps/api/.env` configures the API, Prisma commands, and worker. Workspace scripts
run in their workspace directory. Match the database credentials and port in both
files. The browser uses relative `/api/v1` URLs; Vite proxies these to the API in
development. Use `127.0.0.1` consistently with `APP_ORIGIN` to avoid origin failures.

Start local dependencies, validate the schema, and initialize your **local** database:

```sh
npm run db:up
npm run db:generate
npm run db:validate
npm run db:deploy
npm run db:status
npm run db:seed
npm run dev
```

`db:deploy` applies committed migrations. Seeding upserts the supported catalog;
it creates no accounts or prices and can be rerun. For creating a new migration
on a development database, use `npm run db:migrate -w @marketpulse/api -- --name descriptive_change`.
Never use development migrations or resets against production data.

- Web: <http://127.0.0.1:5173>
- API liveness: <http://127.0.0.1:3001/api/v1/health/live>
- API database readiness: <http://127.0.0.1:3001/api/v1/health/ready>
- Local Mailpit inbox: <http://127.0.0.1:8025>

Prices can initially be unavailable until a market request activates the worker
and a provider fetch completes. Set `CRYPTO_DATA_MODE=demo` for deterministic,
offline demonstrations. See [environment and deployment settings](docs/deployment.md#environment).

## Checks and tests

```sh
npm run db:validate
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```

The default test suite covers configuration/preflight, authentication, market
providers and caching, favorites, chart behavior, watchlists, and alerts. External
provider requests are mocked. Typecheck and build regenerate the Prisma client;
they do not apply migrations or connect to PostgreSQL.

Database integration tests are separate. They require an explicitly configured,
local `marketpulse_test` database with all migrations applied; they refuse other
hostnames or database names. Follow [database test setup](docs/database.md#database-tests),
then run:

```sh
npm run test:db
npm run test:auth:db
npm run test:markets:db
npm run test:watchlists:db
npm run test:alerts:db
```

CI performs these steps on disposable local PostgreSQL databases, including two
seed runs. Run `npm audit --omit=dev` when network access is available, and review
results before changing dependencies. Do not use forced audit upgrades.

## Production deployment

No deployment is performed by these instructions or the current CI workflow.
Review the [deployment runbook](docs/deployment.md) before approving a release.

1. Provide a PostgreSQL database, TLS, secrets, backups, and an HTTPS frontend
   origin. Set production variables in the host's secret store; keep secrets out
   of `VITE_*` variables and static artifacts.
2. Build with the full development toolchain available:

   ```sh
   npm ci --include=dev
   npm run build
   npm run production:check
   ```

   `production:check` requires `NODE_ENV=production`, the exact HTTPS `APP_ORIGIN`,
   a stable `CSRF_SECRET`, and valid PostgreSQL URLs. It validates configuration
   only: it makes no database or provider requests and performs no deployment.

3. After release approval and a verified backup, run the database release job once:

   ```sh
   npm run db:deploy
   npm run db:status
   npm run db:seed
   ```

4. Serve `apps/web/dist` from a static host/reverse proxy with SPA fallback, and
   route `/api/*` on the **same public origin** to the API. Start the compiled API
   with `npm start`, which runs the production preflight first. Set `HOST=0.0.0.0`
   only when the hosting/container network requires it.
5. Verify readiness, deep links, account sessions, favorites, watchlists, and real
   and simulated data labels before admitting traffic. Enable a standalone worker
   with `npm run start:worker` only on an explicitly configured always-on service.

The API does not serve the React build. `vite preview` is a local preview tool,
not a production server. Sleeping services can miss alert crossings; the application
does not reconstruct observations from downtime. Public account launches need a
separate decision on the missing production recovery-email capability.

## Screenshots

No screenshots are bundled yet. Capture them from your running checkout with
synthetic accounts and `CRYPTO_DATA_MODE=demo`, leaving simulated labels visible.
Suggested captures:

| Suggested file under `docs/screenshots/` | Capture                                                          |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `markets-desktop.png`                    | Dashboard, source labels, and starred assets                     |
| `asset-details.png`                      | Chart, time filters, selected observation, and asset information |
| `watchlists.png`                         | A synthetic user's list with cached prices                       |
| `alerts.png`                             | A synthetic target and its eligibility/source explanation        |
| `markets-mobile.png`                     | A narrow viewport with wrapped navigation and table scrolling    |

Create that directory when adding real captures. Use descriptive alt text and
relative Markdown links once files exist. Record the viewport and data mode in
the caption. Hide real names, emails, passwords, tokens, connection strings, and
browser developer tools. Never remove provenance labels to imply demo data is live.

## Documentation

Start with the [documentation index](docs/README.md), [deployment runbook](docs/deployment.md),
[database guide](docs/database.md), [authentication](docs/authentication.md),
[watchlists](docs/watchlists.md), and [alerts](docs/alerts.md). Older phase documents
record historical decisions and verification; current source and the runbook define
the implemented environment contract.

## Author and disclaimer

Akanksha Sharma — [GitHub](https://github.com/akanksha15sharma).

MarketPulse is an educational portfolio project. Market data can be delayed,
unavailable, cached, or simulated. It does not provide investment advice or execute trades.
