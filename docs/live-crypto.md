# Keyless real crypto with CoinPaprika

CoinPaprika replaces CoinGecko as the active real crypto provider. The dashboard,
asset details/charts and watchlists use the existing server-side cache/worker. Stocks
remain explicitly simulated. No API key, account, card, subscription or billing
window is used. Phase 7 remains excluded.

## Upgrade an existing checkout

Merge into apps/api/.env, replacing the old CRYPTO_DATA_MODE setting:

```dotenv
CRYPTO_DATA_MODE=coinpaprika
STOCK_DATA_MODE=demo
MARKET_WORKER_ENABLED=true
CP_MINUTE_ATTEMPT_LIMIT=10
CP_DAILY_ATTEMPT_LIMIT=260
CP_MONTHLY_ATTEMPT_LIMIT=8000
CP_CHART_DAILY_LIMIT=80
```

CoinPaprika is also the default when CRYPTO_DATA_MODE is absent. Explicit
CRYPTO_DATA_MODE=demo remains available for offline synthetic development. The old
coingecko mode is rejected instead of silently mapped to demo. Old COINGECKO__/CG__
settings are unused and can be removed. No replacement credential variables exist.
Do not overwrite existing database or authentication settings.

Two additive migrations are required: 20261122000400_coinpaprika_provider adds a
new enum value; 20261122000500_coinpaprika_mappings uses it after that migration has
committed. Existing assets, UUIDs, watchlists, portfolios and old quote/history rows
are untouched. Old CoinGecko data is never relabeled or served as CoinPaprika data.
The updated idempotent seed retains canonical asset keys and legacy mappings.

```sh
cd ~/Documents/marketpulse
nvm use
npm run db:up
npm run db:generate
npm run db:validate
npm run db:deploy
npm run db:seed
npm run markets:check
npm run dev
```

The preflight reads PostgreSQL provider state and budgets only. It makes no upstream
requests, starts no worker and resets nothing. A passing preflight is local readiness,
not proof of external API availability. Initial prices can be unavailable until the
worker completes; quote cooldowns survive restarts. If PostgreSQL is unavailable or
the new migrations have not been applied, resolve that before live acceptance.

## Only free public endpoints

The adapter's fixed base is https://api.coinpaprika.com/v1. It permits only:

- GET /tickers?quotes=USD — one global batch, filtered by explicit provider IDs for
  the ten curated crypto assets. No per-row quote request loop or discovery polling.
- GET /tickers/{coin_id}/historical — USD history with start/end, limit=5000 and an
  explicitly free interval: 1h for 1D, 24h for 7D/1M/1Y. Start never exceeds 365 days.

No authentication header or key parameter is sent. The paid api-pro host, simplified
paid ticker endpoint, five-minute history, key-info endpoints and upgrade flows are
never used. Redirects are rejected. Unknown/malformed IDs cannot choose a URL.
Requests have ten-second timeouts and an eight-MiB streamed response cap (the free
all-ticker response includes up to 2,000 assets). Only needed quote/history fields
are normalized to decimal strings with trustworthy source timestamps.

The official [free pricing](https://coinpaprika.com/api/pricing) documents 20,000
calls/month per IP and personal use. [Ticker docs](https://docs.coinpaprika.com/api-reference/tickers/get-tickers-for-all-active-coins)
and [history docs](https://docs.coinpaprika.com/api-reference/tickers/get-historical-ticks-for-a-specific-coin)
identify the public endpoints. The [plan comparison](https://coinpaprika.com/api/pricing)
limits free intraday data to hourly observations in the last 24 hours and daily
prices to one year. Historical availability still varies by asset and response.
No commercial redistribution/deployment or paid access is added by this change.

## Limits and failures

Application ceilings remain below the public allowance: 10 attempts/minute,
260/UTC day, 8,000/UTC calendar month, 80 chart attempts/day. Configuration can lower
but not raise them. Quotes share a ten-minute cooldown and one global batch. The
existing quote/retry category caps, atomic PostgreSQL reservations, leases and
persistent cooldown/circuit state remain in force. All attempts count, including
failures. Other applications sharing an egress IP also consume its provider quota.

429 honors Retry-After; a quote-side 402 pauses for at least 24 hours. Transient
failures get at most two budgeted retries; access denial never suggests a key or
paid plan. Missing/restricted free history (401/402/403/404 or empty data) records
history_unavailable for that asset/range and backs off for 24 hours. It neither
retries rapidly nor disables otherwise-working quote ingestion. Old real history
is retained only within its expiry; no fake points are fabricated.

## Accurate presentation

Real prices and history carry COINPAPRIKA / REAL / simulated=false. Stocks retain
DEMO / DEMO / simulated=true. Shared contracts and UI selection checks reject
contradictory provenance. Each view shows source, source time and fresh/stale/
unavailable state with Powered by CoinPaprika attribution. Missing real prices
stay unavailable; old real observations may remain stale, never become demo.

1D charts are hourly; 7D, 1M and 1Y charts are daily. Chart captions report that
resolution. Source-age thresholds allow two hours for hourly data and 48 hours for
daily data, while cache refresh TTLs remain 30 minutes/six hours/six hours/24 hours.
Quote source staleness stays twenty minutes. Source time is distinct from fetch
time. Expired chart caches are hidden. Unsupported free history explicitly says
unavailable instead of promising a chart is preparing indefinitely.

## Local acceptance

Apply all existing migrations to the dedicated test database too (adjust default
credentials/port if customized):

```sh
DATABASE_URL=postgresql://marketpulse:marketpulse_dev@127.0.0.1:5432/marketpulse_test DIRECT_DATABASE_URL=postgresql://marketpulse:marketpulse_dev@127.0.0.1:5432/marketpulse_test npm run db:deploy
TEST_DATABASE_URL=postgresql://marketpulse:marketpulse_dev@127.0.0.1:5432/marketpulse_test npm run test:db
TEST_DATABASE_URL=postgresql://marketpulse:marketpulse_dev@127.0.0.1:5432/marketpulse_test npm run test:markets:db
```

Tests refuse nonlocal/non-test databases and clean only their own fixtures. No reset
is required. The integration suites check stable seed UUIDs, new mappings, and
preservation/exclusion of legacy CoinGecko caches.

With npm run dev active, open /markets, a crypto detail and /watchlists. Confirm real
CoinPaprika crypto and simulated stocks, then inspect all chart ranges and their
hourly/daily labels. Reload to verify watchlist membership survives the migration.
Pending history can return 202 before a cached 200; unavailable history must remain
clearly unavailable. Do not force failures by consuming live quota; fixture tests
cover rate limits, missing history, malformed responses, outages and cache isolation.

```sh
npm test
npm run lint
npm run format:check
npm run typecheck
npm run build
```

See [CoinPaprika verification](../COINPAPRIKA-VERIFICATION.md) for executed checks and
remaining database/browser acceptance.
