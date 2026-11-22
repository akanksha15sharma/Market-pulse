# Live crypto integration verification

Status: integration and automated fixture verification complete; account-backed
live requests, PostgreSQL acceptance and browser acceptance remain pending.
Phase 7 has not started.

## Changes

- Reused the existing server-only CoinGecko adapter, worker, caches and quota ledger.
- Dashboard, asset details and watchlists show live provider availability, readable
  outage reasons, separate quote/chart budget status and CoinGecko attribution.
- Public contracts enforce provider/mode/simulated agreement. Clients reject a demo
  crypto response when real mode is selected, including chart-mode changes.
- Historical status uses source time as well as fetch/cache time. Previous real
  history remains stale during outages; expired retained charts are hidden.
- Added a read-only markets:check command and server-only activation instructions.
- Stocks remain demo-only. No fallback, schema migration, dependency, quota increase,
  watchlist ownership/auth change or Phase 7 implementation was introduced.

## Results

| Check                                                                         | Result                                                                                                                     |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Expanded backend market suite                                                 | 17 passed, including six new integration-style fixture cases; also run directly                                            |
| New frontend live-data suite                                                  | Seven passed: provenance, stale/unavailable/expired charts, mixed watchlists, budgets, same-origin reads and mode mismatch |
| Full npm test                                                                 | Passed: auth, web, markets and watchlists                                                                                  |
| Workspace typecheck                                                           | Passed, including tools and tests                                                                                          |
| Production builds                                                             | Passed for contracts, API and web                                                                                          |
| ESLint, formatting and diff checks                                            | Passed                                                                                                                     |
| Frontend artifact scan                                                        | No server key identifier, credential header or synthetic-secret marker in built JS/HTML/CSS                                |
| Missing-config preflight                                                      | Correctly failed with not_configured, without upstream requests                                                            |
| Market PostgreSQL suite                                                       | Attempted; blocked by sandbox local database/socket restrictions                                                           |
| Account-backed live smoke                                                     | Not performed: local server has no CoinGecko key or account window configured; no secrets were copied or printed           |
| Browser/mobile visual acceptance                                              | Not performed: local sockets/browser preview unavailable                                                                   |
| Existing schema, migrations, dependencies, lockfile and approved Phase 0 docs | Unchanged                                                                                                                  |

Fixtures exercise real-adapter normalization into the shared cache, 202-to-200 real
history, ten-asset batching, repeat cache reads without extra upstream calls,
real/demo cache isolation, missing live configuration, chart-only/global quota
exhaustion, source-age checks for all ranges, unauthorized history retention and
stock exclusion. Existing timeout/retry/429/circuit/restart tests also remain passing.

No successful PostgreSQL or live API outcome is inferred from fixture tests. Browser
interaction is not claimed from server-rendered markup tests. The preflight inspects
only local readiness, not credential validity at CoinGecko.

Implementation was committed in /tmp/marketpulse-live-crypto because the original
~/Documents/marketpulse repository is outside the session's writable roots. The
exported Git patch can be imported there with git am. Follow [server activation and
local acceptance](docs/live-crypto.md) to configure the key privately, inspect the
persisted budgets, and complete real-account verification. Stop before Phase 7.
