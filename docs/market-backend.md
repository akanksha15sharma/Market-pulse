# Market backend — CoinPaprika free public API

CoinPaprika is now the active real crypto source. The former CoinGecko implementation
and setup are superseded by [keyless live setup](live-crypto.md) and
[ADR 0003](decisions/0003-coinpaprika-free-provider.md). Stocks remain demo-only.

## Existing API

All routes are under /api/v1 and read PostgreSQL caches/catalog, never forward a
request-selected provider URL. The shared worker performs provider operations.

| Endpoint                | Behavior                                                                   |
| ----------------------- | -------------------------------------------------------------------------- |
| GET /assets             | Curated search/filter/sort/pagination; max 50 rows                         |
| GET /assets/:id         | UUID metadata, without provider mappings                                   |
| GET /quotes             | One cache batch, optional max 15 assetIds                                  |
| GET /assets/:id/history | 1D/7D/1M/1Y; 202 while unavailable/pending, 200 when usable                |
| GET /market-status      | Configured modes, provider state, separate quote/chart reasons and budgets |

Quotes and history expose provider, mode, simulated flag, source/fetch times,
fresh/stale/unavailable status and safe reason codes. History also reports its
actual granularity, sourceAt, freshUntil and expiresAt. Unsupported free history
has reason=history_unavailable. Real and demo rows have separate identities; old
CoinGecko rows are retained but excluded from active reads and jobs.

Malformed filters/IDs return 400; unknown catalog IDs return 404. Cache reads remain
60/IP/minute; history remains 6/user/minute (or IP when anonymous). Expired supplied
sessions for history return 401. Market status contains no credentials.

## Worker, quotas and cache

The API's first catalog/quote/history read activates one 15-second worker timer.
Reads extend a ten-minute visitor window; idle timers stop. Optional standalone
workers still require MARKET_ALWAYS_ON=true and explicit worker enabling. API and
worker use the same lazy PostgreSQL pool/ledger and shared leases.

CoinPaprika gets a single free /tickers USD batch on a persistent ten-minute quote
cooldown. Demo stocks refresh once/minute. Per-source leases serialize provider
operations; history requests coalesce by asset/provider/mode/currency/range. At most
four due history jobs run per tick. Source-time guards reject older/equal quotes.
Cleanup runs at most once/minute while active; shutdown stops timers and disconnects.

Global attempt ceilings remain 10/minute, 260/day, 8,000/UTC month; charts 80/day,
scheduled initial quote attempts 4,464/month, retry reserve 1,025/month. Persistent
reservations count success/failure/crashes and roll back atomically on any exhausted
window. Retries use fresh reservations, exponential backoff/jitter and ten-second
request timeouts. 429 respects Retry-After. Quote 402 pauses at least a day. Access
failures and repeated transient failures preserve circuit state across restarts.
No quota reset, key rotation, paid fallback or plan upgrade is implemented.

Free historical resolutions are hourly for 1D and daily for 7D/1M/1Y. History-only
restriction/not-found/empty results back off 24 hours without disabling quote updates.
Cache refresh TTLs stay 30 minutes, six hours, six hours and 24 hours. Historical
cache expiry remains 48 hours. Source staleness allows two hours for hourly points,
48 hours for daily points; quotes are stale after twenty minutes. Provider failure
keeps stale real data or unavailable, never synthetic substitutes. Stocks/demo
crypto keep their explicitly synthetic adapter and its original resolution.

## Setup and verification

Migrations 20261122000400 and 20261122000500 add COINPAPRIKA and its mappings without
renaming existing enum values, asset keys/UUIDs or cache data. New and existing
catalogs can run the idempotent seed. Follow [setup and tests](live-crypto.md).
Previous Phase 4/5/6 reports remain historical; current results are in
[CoinPaprika verification](../COINPAPRIKA-VERIFICATION.md). No Phase 7 code is included.
