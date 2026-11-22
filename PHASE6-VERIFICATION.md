# Phase 6 verification

Status: watchlists implemented and non-database checks passed. PostgreSQL and browser
acceptance remain pending host verification. Phase 7 has not started.

## Delivered

- Authenticated private-list API: create, list/read, rename, delete, add/remove items.
- PostgreSQL persistence using existing tables, per-user transactional locks,
  ownership checks, five-list/twenty-item limits and idempotent membership changes.
- Shared strict request/response contracts, session/CSRF/origin protection,
  persistent per-user rate limits, safe errors and uncached private responses.
- Responsive /watchlists UI with selection, management forms, deletion confirmation,
  crypto/stock catalog picker, current cached prices and Phase 5 provenance labels.
- Inactive saved assets retained as unavailable and removable; no invented prices.
- New unit/frontend/database tests and CI wiring. No Phase 7 work.

## Executed checks

| Check                                                             | Result                                                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Existing npm test suite plus new watchlist suites                 | Passed                                                                                            |
| New backend middleware/contract tests                             | Seven passed; also executed directly                                                              |
| New frontend loader/action/markup tests                           | Six passed; also executed directly                                                                |
| Workspace typecheck, including Prisma tools and tests             | Passed                                                                                            |
| Production builds: contracts, API, web                            | Passed                                                                                            |
| ESLint                                                            | Passed                                                                                            |
| Formatting and git diff --check                                   | Passed                                                                                            |
| PostgreSQL integration suite                                      | Six scenarios authored; execution blocked during fixture creation by connect EPERM 127.0.0.1:5432 |
| Browser/HTTP/mobile visual acceptance                             | Not executed; sandbox disallows local sockets and browser preview is unavailable                  |
| Remote CI                                                         | Updated; not observed remotely                                                                    |
| New migrations or dependencies                                    | None; existing migrations, schema, dependency declarations and lockfile unchanged                 |
| Existing auth/provider/dev-server implementation and Phase 0 docs | Unchanged; app composition only adds the watchlist module                                         |

The database scenarios cover persistence across client recreation, cross-account
read/write isolation, concurrent capacity enforcement across two independent pools,
idempotency at capacity, inactive/unknown assets, deletion cascades and real stored
session expiry/revocation through HTTP middleware. No PostgreSQL success is inferred
from the mocked middleware or frontend tests. Failed connection attempts made no
fixture changes. No database reset or privileged workaround was attempted.

Frontend tests exercise action-to-API methods, CSRF headers, server validation/error
handling, sign-in redirects, saved-price provenance, inactive assets and accessible
management markup. They do not establish real browser interaction or visual quality.

Work was committed in an isolated checkout at /tmp/marketpulse-phase6, based on the
current Phase 5 repository history. The session cannot write to the original
~/Documents/marketpulse repository; the exported Git patch can be imported with git am.

Run npm run test:watchlists:db with an explicit local TEST_DATABASE_URL and follow
the browser acceptance steps in [watchlist setup](docs/watchlists.md) before treating
PostgreSQL and browser acceptance as complete. Stop before Phase 7.
