# Current market dashboard presentation

The public dashboard uses genuine TradingView displays and a responsive catalog
of asset cards. The older Phase 5 notes below describe historical functionality;
use the B–D implementation report for current provider restrictions.

- Desktop navigation has independent logo, centered market/watchlist/alert links,
  and right-aligned theme, notification, and profile controls. Mobile disclosures
  never determine desktop link visibility. The existing session checks and theme
  persistence remain unchanged.
- Asset cards retain the same UUID links, local favorites, URL search/type/favorite
  filters, sort controls, and unavailable-symbol behavior. They do not introduce
  native prices or sample observations. Cards use three, two, or one column as
  the viewport narrows.
- Dashboard typography, controls, card surfaces, and source disclosures use shared
  theme colors. Chart container heights, provider attribution, privacy disclosure,
  loading, failure, and retry behavior remain intact.
- No API, provider mapping, authentication, database, or deployment settings change.

Checks: `npm run test:web`, `npm run lint`,
`npm run typecheck -w @marketpulse/web`, and
`npm run build -w @marketpulse/web`. After the build, run
`npm run test:navbar:browser` and `node scripts/test-market-browser.mjs` with Chrome
installed. These use isolated local fixtures, not production users or prices.
Navbar checks measure all three desktop links and their centered placement at
1024, 1280, and 1440 pixels, then test mobile/tablet behavior in both themes.
Market checks measure rendered cards, favorite controls, contrast, complete widget
frames and source disclosures, with clipping/overlay negative controls and
loading/retry cases. Screenshots are written to the temporary directories printed
by the browser runners. Embedded test frames do not verify live feed delivery.

---

# Phase 5 — market UI

The market dashboard is available at `/` and `/markets`. Asset links open
`/assets/:id` with the current cached quote and historical line chart. Existing
account routes and backend behavior are preserved. Phase 6 watchlists are excluded.

## Browsing

- Four price cards highlight BTC, ETH, SOL and AAPL when present in the catalog.
- The table lists the existing ten crypto assets and five simulated stocks.
- Name/symbol search, crypto/stock filters and alphabetical sorting operate on the
  API's complete 15-asset curated catalog. Search and filters persist in the URL;
  typing does not make provider or per-keystroke API requests.
- Price cards and rows link to the corresponding asset UUID, never just its ticker.
- Missing values remain unavailable; missing percentage changes never become zero.

## Provenance and refresh

Prices show provider, observation time, freshness and real/simulated identity.
Stocks retain explicit simulated-stock context; demo crypto is also labeled.
CoinPaprika attribution appears when real crypto mode is configured. Source refresh
policy comes from `/market-status`; browser polling is a cache read, not a claim
that the provider refreshed. Worker-disabled status is visible.

The overview and asset quote views use one batched quote request per refresh, with
60-second polling while the document is visible. Hidden tabs pause scheduling;
requests are cancelled on navigation. Fetches have a ten-second timeout, validate
public response schemas, and keep prior observations visible alongside a warning
if a refresh fails. Quote staleness also advances from source time in the browser.

History supports 1D, 7D, 1M and 1Y. A 202 response displays a queued-history state;
pending ranges are checked every 20 seconds, and settled ranges every 60 seconds.
History requests are serialized and spaced at least 10.1 seconds apart within a
tab, including rapid range changes. Cancelled ranges do not consume reserved future
slots. The API remains authoritative for limits shared by tabs/users/IP addresses.
429 responses honor Retry-After with at least a 60-second cooldown, including manual
retry attempts. No frontend request contacts a market provider directly.

## Charts and accessibility

Charts load lazily and plot the API's timestamps and price points without invented
candles or sample prices. SVG coordinates use elapsed time; flat series remain
visible. Pointer inspection and a labeled keyboard slider expose the selected
observation. An expandable, scrollable table retains the exact decimal strings.
Number conversion is limited to chart geometry and display formatting; no financial
accounting is performed. Source, granularity, cache time and stale/pending state
remain visible. Empty history has its own pending/unavailable presentation.

The layout adapts to narrow screens, with two-column price cards and a horizontally
scrollable market table. Filters use native controls, selected buttons expose
aria-pressed, errors use role=alert, and the existing skip link and focus treatment
are preserved. No watchlist, portfolio or alert actions are introduced.

## Local verification

With the existing Phase 4 database migrated and seeded:

```sh
npm run dev
```

Open `http://127.0.0.1:5173/markets`. Check both asset types, search by name/symbol,
clear an empty result, and follow a crypto and stock asset. Verify all four ranges,
pending-to-cached history, pointer/keyboard inspection and the data table. Confirm
simulated labels, source timestamps and policy text. Check at 375px and desktop
widths. Hide the tab to confirm polling pauses. With API/network access interrupted,
confirm errors remain visible with retained observations and no fabricated prices.

Automated checks:

```sh
npm test
npm run lint
npm run format:check
npm run typecheck
npm run build
```

See [Phase 5 verification](../PHASE5-VERIFICATION.md) for executed checks and limits.

The live-provider switch and current hourly/daily chart availability are described
in [CoinPaprika setup](live-crypto.md).
