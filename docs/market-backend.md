# Phase 4 — market backend

Status: implemented; synthetic/fixture tests and build checks pass. New PostgreSQL
migration/integration tests await host verification. Phase 5 frontend work is excluded.
Phase 0 provider policy is unchanged; the implementation details below are additive.

## API contract

All endpoints are under /api/v1. No request forwards an arbitrary URL or chooses a
provider. Search uses the seeded local catalog; no provider search calls are made.

| Endpoint                | Query/response                                                                 |
| ----------------------- | ------------------------------------------------------------------------------ |
| GET /assets             | q, type=CRYPTO/STOCK, sort=symbol/name, page, limit (max 50); assets and total |
| GET /assets/:id         | UUID; public asset metadata, without internal provider mappings                |
| GET /quotes             | Optional comma-separated assetIds (max 15); otherwise curated catalog          |
| GET /assets/:id/history | range=1D/7D/1M/1Y; 202 while missing, 200 when cached                          |
| GET /market-status      | Configured modes, provider state, refresh policy, remaining budgets            |

Quotes include string-valued price/changePercent, sourceAt, fetchedAt, status
(fresh/stale/unavailable), provider, mode, simulated and reason. History includes
string prices, source timestamps, granularity, pending/idle refresh and cache status.
Only server-selected source/mode rows are returned. Real outages never return demo
prices. Unknown catalog IDs return 404, malformed/unsupported queries 400. Cache
reads are limited to 60/IP/minute; history to 6/user/minute or 6/IP when anonymous.
Supplying an expired session for history returns 401 instead of impersonating a user.

## Adapters and normalization

DEMO uses invented deterministic prices keyed by asset identity and time; it covers
all 15 assets without credentials. Stocks remain demo-only. Demo quotes refresh at
60-second intervals and become stale at two minutes. History has 5-minute, hourly
or daily sample spacing. No demo value is presented as an actual market quote.

COINGECKO uses one /coins/markets batch for the ten crypto assets and the Demo
/coins/{id}/market_chart endpoint for requested history windows. IDs come from seeded
provider mappings, never raw request input. The API key is sent in a server-only
header to a fixed HTTPS origin; redirects are rejected. Numeric prices become
PostgreSQL-compatible decimal strings. Conversion cannot recover precision beyond
the provider's JSON number representation. Missing/null/untrustworthy timestamps
are not replaced with fetch time. Invalid prices, future times beyond a clock-skew
allowance, malformed payloads and oversized responses fail safely. History points
are sorted and deduplicated; null percentage changes remain null, not invented zero.

Response schemas were checked against the two official endpoint references only;
no live API call or additional pricing research was performed in Phase 4:
[batch markets](https://docs.coingecko.com/demo/reference/coins-markets),
[Demo charts](https://docs.coingecko.com/demo/reference/coins-id-market-chart).
A real stock adapter remains gated by the Phase 0 display/entitlement decision.

## Shared cache and worker

REST reads PostgreSQL only. Missing/stale history is queued by a unique durable
asset/provider/mode/currency/range row; a late reader cannot requeue a fresh result.
The worker prioritizes quote batches and processes at most four history jobs per
tick. Shared leases prevent concurrent provider work and duplicate chart fetches.
Quote writes atomically reject older/equal source timestamps. Range-specific
history keys prevent a 7D refresh from replacing 1D points. No alerts are evaluated.

In the API, the first catalog/quote/history read activates a 15-second worker tick;
subsequent reads extend a ten-minute visitor-activity window without creating new
timers or immediate ticks. Timers stop while idle, allowing database/host sleep.
Quote cooldown leases persist: 60 seconds for DEMO, 600 for CoinGecko. A restart
cannot reset polling eligibility. Pending history jobs also survive restart.

The optional standalone worker requires MARKET_ALWAYS_ON=true and explicit worker
enabling. Run npm run worker:dev or, after building, npm run worker:start. Always-on
compute is a deployment choice, not a promise for free sleeping hosts. API and worker
use the same database, billing windows and limits. Leases allow both entry points
without multiplying upstream requests under normal operation. API auth/market
modules share one lazy Prisma pool. Shutdown stops timers and disconnects the pool;
a crash conservatively retains reservations/cooldowns for restart safety.

Real quotes become stale after 20 minutes from source time. Chart freshness: 1D
30 minutes; 7D/1M six hours; 1Y 24 hours. Cached history becomes unservable after
48 hours. Worker cleanup runs at most once/minute while active. Physical deletion
while hosts sleep is not guaranteed; any stricter provider storage terms require
an independent cleanup deployment before enabling public real-data display.

## Quotas and outage controls

Every CoinGecko attempt atomically reserves all applicable PostgreSQL budget windows
before HTTP. Success and failure both settle into consumed attempts. A crash can
leave a reservation counted; it never frees budget to exceed the cap. A rejected
reservation rolls back every window. No process-local counters substitute for the
persistent global limits.

- Application ceilings: 10/minute, 260/UTC day, 8,000/account billing month.
- Chart attempts: 80/day, including chart retries.
- Initial scheduled quote attempts: 4,464/billing window.
- Retries additionally consume a 1,025/month reserve plus all global limits.
- Billing start/end must explicitly match the provider account; inactive/unknown
  windows prohibit real calls. Configuration can lower, never raise, approved caps.
- Quotes are one global batch; chart requests are coalesced. No metadata polling.

Each HTTP attempt has a ten-second timeout and a two-MiB body limit. Transient
network/5xx failures retry at most twice with exponential backoff/jitter and a new
reservation each time. 429 defers to Retry-After (or at least 60 seconds), without an
immediate retry. 401/403 persists a disabled state. Three failed operations open a
circuit with exponential recovery delay; a provider lease permits only one recovery
probe, rather than a retry burst. State and last successful refresh survive restart.
Chart failures retain old data with an error code and persist the next retry time.

After correcting an unauthorized key, an operator may clear only that provider's
circuit state in PostgreSQL (disabled=false, failures=0, blockedUntil/lastError=NULL).
Never reset provider_usage to work around exhausted quota. All worker instances
must use the same actual billing window; advance it only when the account resets.

## Configuration and setup

Merge apps/api/.env.example into the existing environment, without overwriting secrets.
Default CRYPTO_DATA_MODE=demo and STOCK_DATA_MODE=demo require no market keys.
To opt into real crypto, set CRYPTO_DATA_MODE=coingecko, COINGECKO_LIVE_ENABLED=true,
a valid COINGECKO_API_KEY, and actual UTC CG_BILLING_START/CG_BILLING_END. Keep public
display/caching permission and attribution requirements from Phase 0. Missing live
configuration yields unavailable real data, never synthetic fallback.

Apply 20261122000300_market_cache to both existing databases. It adds durable cache
metadata and provider state, and extends the historical key with its chart range.
Existing rows receive range=1D; no existing migration or account data is reset.

```sh
npm run db:generate
npm run db:validate
npm run db:deploy
DATABASE_URL=postgresql://marketpulse:marketpulse_dev@127.0.0.1:5432/marketpulse_test DIRECT_DATABASE_URL=postgresql://marketpulse:marketpulse_dev@127.0.0.1:5432/marketpulse_test npm run db:deploy
npm test
TEST_DATABASE_URL=postgresql://marketpulse:marketpulse_dev@127.0.0.1:5432/marketpulse_test npm run test:markets:db
npm run dev
```

With seeded assets and the API running, request /api/v1/assets, then /api/v1/quotes.
The first quote response can be unavailable until the worker completes. Request
history using a returned asset UUID; expect 202 initially, then cached 200 after
processing. Repeated reads do not make per-user upstream requests. /market-status
contains no keys, headers or credential URLs. No market UI is added in this phase.

## Verification

Eleven deterministic provider/cache/REST tests cover batching, source timestamps,
429/auth failures, retries, stale real-data preservation, quota denial, restart
cooldowns, concurrent chart misses, late-reader races and circuit recovery. Four
PostgreSQL tests cover source-time guards, atomic multi-window quotas, durable leases
and independent cached ranges. Tests use synthetic payloads and an explicit local
marketpulse_test database; they never consume live API quota. CI includes both suites.

See [Phase 4 results](../PHASE4-VERIFICATION.md). More extensive metrics/load tests and
public deployment checks remain in their later roadmap phases.
