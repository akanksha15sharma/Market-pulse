# CoinGecko live crypto integration — before Phase 7

The existing Phase 4 CoinGecko adapter and PostgreSQL cache/worker feed the Phase 5
market dashboard/details and Phase 6 watchlists. This change completes live-data
status presentation and source freshness checks. Stocks remain simulated. No
portfolio or other Phase 7 functionality is included.

## Enable with your own server-side configuration

The current local server was checked without displaying any credentials: no
CoinGecko key or billing window was configured. No live account request was made.
A credential-free checkout intentionally stays in demo mode until explicitly
configured. Selecting CoinGecko never enables a synthetic fallback for crypto.

Merge these settings into the existing **apps/api/.env**, replacing each existing
setting rather than overwriting the file. Replace all placeholders with your own
Demo key and the actual UTC reset window shown by your CoinGecko account:

```dotenv
CRYPTO_DATA_MODE=coingecko
STOCK_DATA_MODE=demo
MARKET_WORKER_ENABLED=true
COINGECKO_LIVE_ENABLED=true
COINGECKO_API_KEY=REPLACE_WITH_YOUR_DEMO_KEY
CG_BILLING_START=REPLACE_WITH_ACTUAL_ACCOUNT_START_ISO_UTC
CG_BILLING_END=REPLACE_WITH_ACTUAL_ACCOUNT_END_ISO_UTC
```

ISO UTC timestamps have the form YYYY-MM-DDTHH:mm:ss.sssZ. Both bounds must match
your account; expired/future windows pause real calls. Incomplete enabled-live
configuration fails validation. To run the API without live credentials, leave
COINGECKO_LIVE_ENABLED=false. With CRYPTO_DATA_MODE=coingecko, crypto then reports
unavailable/not_configured while stocks continue in demo mode.

Keep keys out of VITE_ variables, frontend code, Git, URLs and chat. The backend
sends the key only in x-cg-demo-api-key to the fixed CoinGecko Demo HTTPS origin.
The browser uses only /api/v1 cache endpoints. .env remains ignored. No API key is
returned by /market-status, error messages, logs from the preflight, or UI data.

With the existing application database configured and migrated:

```sh
cd ~/Documents/marketpulse
nvm use
npm run db:up
npm run db:generate
npm run db:deploy
npm run db:seed
npm run markets:check
npm run dev
```

The preflight is read-only: it checks local configuration, worker enabling,
persisted provider state and remaining application budgets. It makes no upstream
request, starts no worker, and reserves/resets nothing. A passing preflight is not
proof the provider accepted the key. A nonzero result explains missing setup or a
paused/exhausted provider. Do not reset usage counters to clear a failure. For
correcting an unauthorized provider, follow the existing targeted circuit-state
repair in [market backend operations](market-backend.md).

## Free-tier bounds

Checked against the official [pricing](https://www.coingecko.com/en/api/pricing),
[Demo markets endpoint](https://docs.coingecko.com/demo/reference/coins-markets) and
[Demo history endpoint](https://docs.coingecko.com/demo/reference/coins-id-market-chart).
The pricing page currently lists 100 calls/minute and 10,000/month for Demo.
MarketPulse retains its lower approved ceilings: 10 attempts/minute, 260/UTC day,
8,000/actual account window and 80 chart attempts/day. Limits may be lowered, not
raised above these application ceilings. Other applications on the same account
also consume its provider allowance; keep an appropriate allowance for their use.

One shared batch covers the ten crypto assets, at most once per ten-minute quote
cooldown. Chart ranges are 1D, 7D, 1M and 1Y (365 days), with automatic granularity.
History misses coalesce. PostgreSQL reservations, leases and cooldowns survive
restart and apply across workers. Retries consume the existing global/category
budgets, 429 respects Retry-After, and 401/403 disables provider operations. Stocks
never go to CoinGecko. Browser refreshes read shared caches; they do not bypass caps.
Phase 0 provider display/storage permissions remain unchanged.

## What the UI means

- **Real market data / fresh**: CoinGecko provenance with a usable source observation.
- **Real market data / stale**: a previous real observation remains visible, with
  stale status and an explanation. Fetch time never establishes source freshness.
- **Real market data / unavailable**: no usable real observation is available. No
  demo value or demo history is substituted, including when a demo cache exists.
- **Simulated data**: the explicit synthetic mode. Stocks are always in this mode;
  crypto uses it only when the server explicitly selects demo mode.

Dashboard, details and watchlists show the shared live-feed state, source/time and
request budgets. Quote and chart availability are distinct: exhausting the daily
chart allowance does not label quote updates blocked. CoinGecko attribution links
to its API page. Public schemas reject contradictory provider/mode/simulated flags,
and clients reject quote/chart data inconsistent with the selected mode.

Real quote staleness remains twenty minutes from source time. Chart status combines
cache freshness with the newest source point: application source-age thresholds are
30 minutes for 1D, six hours for 7D/1M and 48 hours for 1Y (daily samples need UTC-day
grace). Cache refresh intervals remain 30 minutes, six hours, six hours and 24 hours.
Old-source responses do not trigger a rapid refetch loop. Cached chart data expires
after 48 hours, and the UI hides an expired retained chart even if refresh failed.

## Local live acceptance

After startup, open /markets and a crypto asset, then /watchlists with a saved crypto
and stock. Confirm real CoinGecko labels on crypto, explicit demo labels on stocks,
source times and attribution. Request history and wait for queued processing.

From another Ubuntu terminal:

```sh
BASE='http://127.0.0.1:3001/api/v1'
curl -fsS "$BASE/market-status" | python3 -m json.tool
ASSET_ID=$(
  curl -fsS "$BASE/assets?type=CRYPTO&limit=1" |
  python3 -c 'import json,sys; print(json.load(sys.stdin)["assets"][0]["id"])'
)
curl -fsS "$BASE/quotes?assetIds=$ASSET_ID" | python3 -m json.tool
curl -sS -w '\nHTTP %{http_code}\n' "$BASE/assets/$ASSET_ID/history?range=1D"
sleep 20
curl -sS -w '\nHTTP %{http_code}\n' "$BASE/assets/$ASSET_ID/history?range=1D"
```

Initial quotes may be unavailable and history 202 until the worker finishes; cached
history is 200. Persisted ten-minute quote cooldowns also survive restarts, including
failed attempts, so startup does not promise an immediate new quote. Inspect all
four chart ranges without rapid repeated requests. Verify that a provider failure
keeps previous real values stale or returns unavailable, while stocks stay demo.
Do not consume live quota to force failures; automated fixtures cover outages.

Automated verification uses fake providers, never account credits:

```sh
npm test
npm run lint
npm run format:check
npm run typecheck
npm run build
TEST_DATABASE_URL=postgresql://marketpulse:marketpulse_dev@127.0.0.1:5432/marketpulse_test npm run test:markets:db
```

See [live integration verification](../LIVE-CRYPTO-VERIFICATION.md) for executed
checks and outstanding local acceptance.
