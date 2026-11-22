# Phase 7 price-alert verification

Status: requested price-alert scope implemented; non-database automated checks
passed. PostgreSQL migration/integration and real browser acceptance remain pending.
The phase-order change is explicit in [ADR 0004](docs/decisions/0004-price-alerts-phase-7.md).
No further-phase implementation is included.

## Delivered

- Authenticated private target create/read/edit/pause/rearm/delete and paginated history.
- Ten active alerts/user with transactional ownership, capacity and duplicate checks.
- Exact inclusive decimal thresholds; stock targets stored but blocked from simulation.
- Evaluation only on accepted newer real CoinPaprika quote ingestion, with strict
  post-arm source/fetched times, no future times and a twenty-minute freshness bound.
- Atomic quote/event/status writes, stable row lock order and one event per activation.
- Immutable source/target snapshots, database audit constraint and labeled legacy events.
- Responsive management UI, blocked-data guidance, accessible forms and history.
- New unit/frontend/PostgreSQL tests and CI wiring; no new dependencies.

## Executed checks

| Check                                                                                       | Result                                                          |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| New alert backend predicate/middleware tests                                                | Eight passed; also executed directly                            |
| New frontend loader/action/markup tests                                                     | Eight passed; also executed directly                            |
| Full npm test                                                                               | Passed, including prior auth/market/watchlist suites            |
| Workspace typecheck                                                                         | Passed, including Prisma tools and tests                        |
| Production builds                                                                           | Passed for contracts, API and web                               |
| Prisma generation/schema validation                                                         | Passed                                                          |
| ESLint, formatting and git diff --check                                                     | Passed                                                          |
| PostgreSQL migration deploy                                                                 | Attempted on local test database; P1001 reaching 127.0.0.1:5432 |
| New PostgreSQL scenarios                                                                    | Seven authored; host acceptance remains pending                 |
| Browser/mobile interactive acceptance                                                       | Not executed; local sockets/browser preview unavailable         |
| Live provider calls                                                                         | None; synthetic fixtures/mocked HTTP only                       |
| Existing provider quotas, auth, watchlist ownership, dependencies/lockfile and Phase 0 docs | Unchanged                                                       |

Database scenarios cover ownership, concurrent create/rearm limits across two pools,
duplicate/replayed/out-of-order ingestion, demo/stale/future/pre-arm/inactive/paused/
historical exclusions, blocked stocks, edit/rearm snapshots, deletion, atomic
rollback and audit constraints. These are not claimed to pass from in-memory tests.
No database reset or production-data cleanup was attempted.

Frontend tests cover private reads/history, CSRF-protected actions, exact target
submission, error/expired-session handling, stock/demo blocking, immutable source
snapshots and management markup. They do not prove real browser interaction.

The feature is prepared on branch codex/price-alerts in /tmp/marketpulse-alerts,
based on the current repository including its GitHub README merges. This session
cannot write the original ~/Documents/marketpulse checkout. The user-authorized
GitHub feature-branch push is attempted after checks and commit; no remote CI pass
or deployment is claimed by this report. The exported patch can be applied locally.

Run the host migration/database commands and manual acceptance in
[alert setup](docs/alerts.md). Stop after the requested alerts scope, before Phase 8.
