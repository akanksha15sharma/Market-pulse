# ADR 0001 — Phase 0 baseline

Date: 2026-11-22. Status: planning finalized; Phase 1 awaits approval.

## Accepted decisions

1. Keep requested stack and modular monolith; polling before Socket.IO.
2. Ten crypto assets, five synthetic US stocks, USD, paper portfolios only.
3. CoinGecko Demo crypto: shared 10-minute batches, capped on-demand charts.
4. Synthetic public stocks; Twelve Data adapter conditional on exact entitlements.
5. Separate real/demo prices, caches, alert identities and valuation contexts.
6. Durable PostgreSQL counters, leases, notifications and jobs; no Redis initially.
7. Same-origin Render plus Neon demo accepts sleep. Continuous alerts require
   always-on compute and a separate availability decision.
8. In-app notifications baseline; Mailpit locally, Resend optional with verified sender.
9. Original Phase 1–12 ordering and small meaningful commits remain unchanged.

## Clarifications to original plan

Crypto provider refresh is 10 minutes, not 1 minute; browser polling reads shared
cache. Charts are line charts initially, not assumed OHLC. API access does not
establish stock display rights, even for a private dashboard. Free-host activity is
visitor-scoped to preserve compute, so alert availability is intentionally limited.

## Open items and defaults

| Item | Safe default | Resolve by |
|---|---|---|
| CoinGecko key and billing reset | Synthetic crypto; no live requests | Phase 4 |
| Exact crypto display/caching rights and attribution wording | Check terms before public release; no raw redistribution | Phase 12 |
| Stock display/exchange/history rights | Synthetic stock provider | Before any real stock mode |
| Job library and Neon pooling compatibility | pg-boss candidate; compatibility test required | Phase 8 or earlier queue adoption |
| Verified sending domain | Local Mailpit; hosted email disabled | Phase 9 |
| Hosting account capacity/region | No resources provisioned; recheck limits | Phase 12 |
| Continuous-alert budget | Demonstration availability only | Before promising continuous operation |

These do not block Phase 1 using synthetic data. No account-specific entitlements,
credentials or API responses were tested; no accounts/purchases were made.

## Phase 0 checks

- Primary public provider and hosting references reviewed on decision date.
- 31-day arithmetic: 4,464 + 2,480 + 31 + 1,025 = 8,000 attempts, below 10,000.
- Per-window/category limits, weighted stock credits, retries and restart persistence specified.
- Real/demo matrix, sleeping-host alerts, email restrictions and release gates documented.
- Only documentation added; no application, dependencies or deployment created.

Suggested focused commit when Phase 1 initializes a dedicated repository:
`docs: finalize Phase 0 scope architecture and provider budgets`

Phase 0 does not initialize Git or commit into the enclosing workspace repository.
