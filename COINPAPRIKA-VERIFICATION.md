# CoinPaprika provider-switch verification

Status: keyless integration implemented; automated non-database checks passed.
Database migration/integration and real browser acceptance remain host checks.
No Phase 7 work is included.

## Delivered

- Replaced the active CoinGecko adapter/config/UI source with CoinPaprika's fixed
  free public host and two keyless route patterns. No keys, accounts or payment.
- One shared quote batch; hourly 1D and daily 7D/1M/1Y historical data when available.
- Explicit unavailable free history with persistent per-range 24-hour backoff;
  restrictions/empty responses do not disable healthy quotes or suggest upgrades.
- Accurate source/resolution/status/attribution across dashboard, details and watchlists.
- Conservative shared quota, cooldown, timeout and cache isolation behavior retained.
- New provider enum plus explicit mappings, preserving asset IDs, watchlists and old
  CoinGecko observations. No edits to applied migrations or resets.

## Verification

| Check                                                                 | Result                                                                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Backend market fixtures                                               | 20 passed, also executed directly                                                                         |
| Frontend live-data fixtures                                           | Eight passed, also executed directly                                                                      |
| Full npm test                                                         | Passed: auth, web, markets, watchlists                                                                    |
| Prisma generation and schema validation                               | Passed                                                                                                    |
| Workspace typecheck and production builds                             | Passed                                                                                                    |
| ESLint, formatting, git diff --check                                  | Passed                                                                                                    |
| Dependencies / lockfile / auth and watchlist ownership implementation | Unchanged                                                                                                 |
| Applied migrations / approved Phase 0 documents                       | Unchanged; new migrations/ADR are additive                                                                |
| PostgreSQL migration deployment                                       | Attempted against local test DB; blocked by P1001 reaching local PostgreSQL                               |
| PostgreSQL tests                                                      | New mapping/legacy-cache cases authored; not accepted as passed here                                      |
| Public ticker inspection                                              | Free BTC, XRP and AVAX JSON responses inspected through read-only web access without credentials          |
| Real application ingestion and historical smoke / browser QA          | Not verified: local sockets/browser unavailable; external history fetch through web tool was inaccessible |

Fixtures assert absence of auth headers, fixed free origin, one batch, UTC budget
windows, free-only historical intervals, partial/malformed data, retries/429/402,
source timestamps, stock exclusion, explicit missing history, 24-hour job backoff,
real/demo cache isolation and source/status display. No live success is inferred
from mocked HTTP or in-memory persistence. Public API inspection is not a complete
worker/database/browser smoke test.

Work is committed in /tmp/marketpulse-coinpaprika because this session cannot write
the original ~/Documents/marketpulse repository. Import the Git patch there, update
CRYPTO_DATA_MODE=coinpaprika in apps/api/.env, apply the two additive migrations,
seed and run the local database/browser checks in [keyless setup](docs/live-crypto.md).
