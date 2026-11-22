# Phase 5 verification

Status: market UI implemented; automated verification passed. Browser acceptance
against a running local API remains pending. Phase 6 has not started.

## Delivered

- Dashboard at `/` and `/markets`: crypto and stock listings, URL-backed catalog
  search/type/sort controls, price cards and linked asset detail pages.
- Historical line charts at `/assets/:id`: 1D/7D/1M/1Y ranges, lazy loading,
  pointer inspection, keyboard observation slider and exact-value data table.
- Simulated-data labels, CoinGecko attribution in real crypto mode, source times,
  refresh policy, worker-disabled notice and stale/unavailable/error states.
- Visible-tab cache polling, abortable requests, pending 202 handling, serialized
  history pacing and Retry-After cooldowns without direct provider requests.

## Checks

| Check                                                 | Result                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Existing npm test suite                               | Passed: auth, frontend and market suites                                          |
| New market UI tests                                   | Nine passed, also executed directly with the web JSX configuration                |
| ESLint                                                | Passed                                                                            |
| Formatting and git diff --check                       | Passed                                                                            |
| Workspace typecheck                                   | Passed                                                                            |
| Production builds                                     | Passed for contracts, API and web; separate lazy-loaded history chunk emitted     |
| Dependencies and lockfile                             | Unchanged; no new npm packages                                                    |
| Backend, migrations and authentication implementation | Unchanged                                                                         |
| Approved Phase 0 documents                            | Unchanged                                                                         |
| Live provider calls                                   | None; tests use synthetic fixtures and mocked fetch                               |
| Browser / HTTP / mobile visual acceptance             | Not executed: sandbox disallows local sockets and no browser preview is available |
| Phase 4 database acceptance                           | Not rerun; existing Phase 4 verification remains authoritative                    |

The new tests cover catalog filtering/sorting, null-value presentation, source-time
staleness, provenance labels, finite flat-series geometry, accessible chart/table
markup, timestamp ordering, batched requests and schema validation, 202 responses,
request cancellation, history request spacing, and Retry-After behavior. They do not
claim browser pointer/keyboard or responsive-layout verification.

Work was performed and committed in an isolated checkout under
`/tmp/marketpulse-phase5`, based on the existing repository history. This session
cannot write to the original `~/Documents/marketpulse` repository. The exported Git
patch can be applied there with git am; no original files were overwritten.

Manual acceptance steps are in [market UI setup](docs/market-ui.md). Check desktop
and 375px layouts, crypto and simulated stock details, all ranges, keyboard access,
pending-to-cached history, and visible/hidden-tab polling against the local API.
Stop at Phase 5; no watchlist, portfolio, alert or deployment work is included.
