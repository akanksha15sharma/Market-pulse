# Phase 2 — PostgreSQL and Prisma

Status: locally verified. The user reports migrations applied to both PostgreSQL
databases, successful seeding, all four database tests passing, and lint, typecheck
and build passing. See [verification evidence](../PHASE2-VERIFICATION.md) for attribution
and lockfile review. Phase 0 documents are unchanged; Phase 3 has not started.

## Technical decisions

Use matching Prisma CLI/client/adapter-pg 7.10.1 with PostgreSQL 17 and the pg driver.
Prisma 7 requires a driver adapter and config-based migration URL. Generate the ESM
client into apps/api/src/generated/prisma (ignored); TypeScript compiles it with API
code. Never commit generated client code. Runtime uses DATABASE_URL; CLI migrations
prefer DIRECT_DATABASE_URL (unpooled), falling back to DATABASE_URL. CLI generation
and validation are designed to run without contacting a database.

Sources: [Prisma 7 setup](https://www.prisma.io/docs/orm/v7/prisma-client/setup-and-configuration/introduction),
[configuration](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference),
[explicit seeding](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding).

## Schema and relationships

| Tables                           | Responsibility                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------- |
| users, sessions, auth_tokens     | Future identity, hashed credentials/tokens, verification and expiry             |
| assets, asset_provider_mappings  | Stable catalog keys and provider-specific identifiers                           |
| latest_quotes, historical_bars   | Source/mode/currency-specific observations and expiring historical price series |
| watchlists, watchlist_items      | User-owned lists and unique asset memberships                                   |
| portfolios, transactions         | User-owned paper ledger, fees and explicit real/demo context                    |
| price_alerts, alert_events       | Threshold definitions and one trigger per arming activation                     |
| notifications, email_deliveries  | Persistent inbox and recoverable alert-email delivery metadata                  |
| outbox_events                    | Committed events for later delivery                                             |
| provider_usage, scheduler_leases | Durable budget windows and worker ownership                                     |

Users own many sessions, tokens, lists, portfolios, alerts and notifications. Assets
are shared and protected with restrictive foreign keys. User deletion cascades through
owned children; catalog assets remain. Transactions reference portfolio ID and mode
as a composite foreign key, preventing a ledger row from changing valuation context.
Quotes/history include source, mode and currency in their identities. Alert events
uniquely identify alert plus activation; future rearming increments activation.
Notifications deduplicate user/event pairs, and email deliveries deduplicate events.

UUID defaults and updatedAt are assigned by Prisma. Timestamps use timestamptz(3)
and UTC application semantics. Financial values use numeric(38,18), not floats.
PostgreSQL constraints enforce positive price/quantity/threshold, nonnegative fees,
volume and counters, valid quota windows, normalized unique email and USD scope.
Provider/mode checks prevent a DEMO provider being labeled REAL and vice versa.
A migration-owned trigger rejects REAL quote/history/transaction/alert rows for a
demo-only asset. Version 1 stock assets must remain demo-only; enabling entitled
real stocks requires a deliberate future migration. Prisma does not model SQL CHECK
constraints/triggers; preserve them in future migration reviews.

No database trigger implements trading or alert logic. Ownership authorization,
portfolio oversell checks, source freshness, atomic budget reservation and outbox
processing belong to later roadmap services. Job-library-managed tables are deferred
until the queue is selected; no guessed pg-boss internal schema is created.

HistoricalBar deliberately contains close and optional volume only: line charts are
in scope, OHLC candles deferred. Check constraints and tests are not a claim of full
cross-user authorization or alert-processing correctness.

## Initial migration

apps/api/prisma/migrations/20261122000100_initial_schema/migration.sql is an authored
initial PostgreSQL migration, including indexes, foreign keys, checks and demo-mode
triggers. The user reports it successfully applied to both local PostgreSQL databases.
For a new environment, apply to an empty development/test database after installation
and review.
Before release, validate with prisma validate, deploy against a clean PostgreSQL
instance and compare the resulting schema with Prisma using migrate diff. Never
edit an applied migration; create a subsequent migration when changing deployed data.

## Seed

The catalog seed performs transactional upserts by stable asset key. Running twice
keeps asset IDs stable. It adds exactly ten curated crypto assets and five demo-only
NASDAQ stocks on an otherwise empty database. Crypto has COINGECKO and DEMO mappings;
stocks have only DEMO mappings (25 mappings total). XRP maps to ripple; Avalanche to
avalanche-2. No network calls, market prices, users, passwords or personal data are
seeded. Existing user records/transactions are never deleted. isActive is not reset.
The seed is explicit in Prisma 7, not automatic during migration deploy.

## Local setup

```sh
npm install
cp apps/api/.env.example apps/api/.env  # only when the file does not already exist
npm run db:up
npm run db:generate
npm run db:validate
npm run db:deploy
npm run db:status
npm run db:seed
npm run db:seed
```

Do not overwrite an existing .env. Match Compose credentials/port if customized.
For later schema edits use npm run db:migrate -- --name descriptive_change (workspace
forwarding may require invoking npm run db:migrate -w @marketpulse/api directly).
Never run reset against valued data; no destructive reset is needed for this phase.
The liveness route remains independent of database availability.

## Database tests

Use a dedicated local marketpulse_test database, never the application database.
Tests refuse any other database name or any non-local hostname. No fallback to
DATABASE_URL and no broad database reset. Each test rolls back its changes, including
catalog seeding. Constraint tests use savepoints so expected failures do not poison
the surrounding PostgreSQL transaction. Test database should contain only migrations
and optionally the standard catalog, not custom fixtures.

```sh
docker compose exec -T postgres createdb -U marketpulse marketpulse_test
DATABASE_URL=postgresql://marketpulse:marketpulse_dev@127.0.0.1:5432/marketpulse_test DIRECT_DATABASE_URL=postgresql://marketpulse:marketpulse_dev@127.0.0.1:5432/marketpulse_test npm run db:deploy
TEST_DATABASE_URL=postgresql://marketpulse:marketpulse_dev@127.0.0.1:5432/marketpulse_test npm run test:db
```

createdb is a one-time action; skip if the database already exists. Use sudo docker
only from a host terminal if daemon permissions require it. Tests cover seed reruns,
provider mappings, unique/FK constraints, deletion cascades, decimal round trips,
positive amounts, mode separation, and duplicate alert events. CI now includes these
steps, but has not been run remotely. All test data is synthetic.

## Lockfile and reproducible installation

The generated root package-lock.json now matches all workspace manifests, pins the
Prisma CLI/client/adapter to 7.10.1 and records npm registry sources with SHA-512
integrity. It is committed for reproducibility. CI uses npm ci with npm caching;
use npm ci for a fresh checkout. An offline npm ci dry run and a subsequent clean offline installation (406 packages)
passed during review, both with lifecycle scripts disabled. This verifies cached
package installation, not lifecycle hooks or database connectivity.

Earlier registry/Docker restrictions blocked the initial agent verification. The
user subsequently completed local migration, seed, database-test and application
checks. The review did not independently rerun database operations, and remote CI
has not yet been observed. No Phase 3 behavior is included.
