# Dashboard API failure handling and automatic refresh

## Cause and fix

Overview and asset detail previously required `/market-status` to succeed alongside
`/assets` and `/quotes`. A status HTTP error rejected the entire `Promise.all`,
hiding valid prices behind “Market data is temporarily unavailable”. Invalid
status payloads also prevented rendering.

Status diagnostics are now optional. Catalog and quotes must still pass the
shared schemas, match catalog assets and use DEMO for stocks. Available status
must match the selected crypto mode. Without status, the quote schema still
validates provider/mode/simulated provenance. No prices, timestamps, provider
configuration or worker health are manufactured. A separate notice explains
missing diagnostics on dashboard, details, watchlists and alerts. The next
successful poll restores diagnostics.

The browser reads the backend every 60 seconds while visible, pauses when hidden,
resumes on return, prevents concurrent reads for a resource, honors cooldowns and
aborts on unmount. Errors retain previous observations with a warning; recovery
clears the error. The dashboard separates the last successful browser check from
each price's source observation time. Stock labels persist without cached quotes.

The CoinPaprika batch, PostgreSQL cache, request budgets and 10-minute crypto
source interval are unchanged. Browser polling never calls CoinPaprika directly
and does not guarantee a new provider observation every minute. Missing real
prices remain unavailable and expired observations retain stale labels.

## Automated verification

Run from the repository root:

```bash
npm test
npm run lint
npm run format:check
npm run typecheck
npm run build
```

New regressions cover status HTTP/schema failure with valid prices, asset detail,
CoinPaprika provenance without diagnostics, recovery, essential quote failures,
uncached stock labeling, repeated polling, visibility pause/resume, cooldowns,
non-overlapping requests and cancellation. Existing live crypto, history,
watchlist, alert and authentication tests remain applicable.

Verified in the writable clone: all five commands above passed. The market web
file passed 15 tests, including six new regressions. Live browser/provider
verification was not run in the sandbox.

## Local browser checks

1. Run `npm run dev` with PostgreSQL and the existing market worker. Open
   `/markets` and inspect browser network requests.
2. Confirm assets, quotes and market-status use `/api/v1` on the same origin.
   Temporarily block only `*/api/v1/market-status`, then reload. Prices and catalog
   should remain visible with the diagnostics warning, including on asset details.
   Restore requests; the next poll should clear the warning.
3. Keep the tab visible for at least 65 seconds. The browser check time should
   advance. Source times change only when the backend receives newer observations.
   Stocks must remain simulated.
4. Hide the tab, then return. Refresh should resume without concurrent duplicate
   requests. A 429 must respect Retry-After even across visibility changes.
5. Block quotes after a successful read. The error should accompany retained
   observations; freshness still uses source time. Restore requests and confirm
   recovery. With no cached real quote, price must be unavailable, never zero or
   a demo replacement.

No migrations are required. Browser and live-provider checks require a local
runtime; the sandbox cannot access local PostgreSQL or the external provider.
