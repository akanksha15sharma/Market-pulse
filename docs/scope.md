# Scope and acceptance criteria

Finalized for planning on 2026-11-22. Implementation awaits Phase 1 approval.

## Product goal

Demonstrate typed full-stack development, secure accounts, relational modeling,
shared API caching, financial calculations and recoverable alert delivery.
“Live” means periodically refreshed observations, not exchange tick data.
Every price view must show source, observation time and refresh policy.

## Version 1

- Email/password accounts, cookie sessions, verification and password recovery.
- Dashboard, market list, curated-catalog search and asset detail pages.
- Interactive historical line charts and current allocation chart.
- Multiple named watchlists with persistent membership.
- Manual paper buys/sells, fees, weighted-average cost, realized/unrealized P&L.
- One-time above/below alerts; pause, edit, rearm, delete and trigger history.
- Persistent in-app inbox and optional queued email notifications.
- Responsive, accessible UI with loading, empty, stale and error states.
- Backend polling first; browser Socket.IO delivery in Phase 10.

Initial catalog: Bitcoin, Ethereum, Solana, XRP, Cardano, Dogecoin, Avalanche,
Chainlink, Litecoin and Polkadot. Map by provider asset IDs, not ticker alone.
Simulated US stocks: AAPL, MSFT, AMZN, GOOGL and NVDA. USD only.
Search the local catalog; full-market discovery is outside version 1.

Initial application limits: 5 watchlists/user, 20 items/list, 10 active alerts/user,
1 portfolio/user and 50 asset subscriptions/socket. Schema permits future portfolios.
These are product limits, not provider entitlements.

## Real data versus demo mode

| Feature | Baseline | Required presentation |
|---|---|---|
| Crypto quotes/summaries | CoinGecko Demo when configured and permitted | Real observations, 10-minute polling, source timestamp, attribution |
| Crypto charts | On-demand provider history, up to 365 days | Historical prices and supplied granularity; no invented candles |
| Stock quotes/charts | Deterministic synthetic series | Persistent “Simulated stock data” labels |
| Portfolio transactions | User-entered paper trades | “Simulated portfolio”; no brokerage execution |
| Portfolio valuation | Quotes matching the portfolio's mode | Synthetic or incomplete valuation explicitly marked |
| Crypto alerts | Fresh real observations in real-data mode | Poll-based, only while service operates |
| Stock/demo alerts | Synthetic observations | “Demo alert”; no claim of a real threshold event |
| In-app inbox | Persisted application events | Real/demo event provenance visible |
| Email | Real only when configured; Mailpit locally otherwise | Hosted email-unavailable state when disabled |

Support the baseline (real crypto plus simulated stocks) and an entirely synthetic
sandbox for previews, tests and credential-free demos. Mode belongs in quote/cache
identity, alert context and portfolio context. Separate real and sandbox portfolios;
never present a valuation containing synthetic stocks as a real combined market value.
Never silently replace unavailable real quotes with synthetic prices.
Anonymous demo writes must be visitor-isolated or disabled; demo sessions cannot
send arbitrary recipients email.

## Alert semantics

Above means >=; below means <=. If already satisfied, the next fresh observation
after arming may trigger; explain this in the form. Require an observation fetched
after arming and a trustworthy source timestamp. One event per activation; rearming
starts another. Reject invalid, duplicate, stale and out-of-order observations.
Paused/triggered alerts are not evaluated. No reconstruction of missed crossings
after downtime. Delay may include a full polling interval plus provider/processing
lag while running; this is not an SLA. Email acceptance is not proof of inbox delivery.

## Deferred

Broker/exchange linking, actual trades, payments, multi-currency, Indian stocks,
recurring crossing alerts, full-market discovery, taxes, split/dividend accounting,
historical portfolio returns, predictions, news, candlesticks, Redis, microservices
and horizontal API scaling. Paper stock accounting is not corporate-action-adjusted.

## Roadmap remains unchanged

0 scope/providers/architecture; 1 repository foundation; 2 database; 3 authentication;
4 market backend; 5 market UI; 6 watchlists; 7 portfolio; 8 alerts; 9 notifications;
10 socket delivery; 11 hardening; 12 deployment/presentation.

Later verification: provider normalization/quota tests in Phase 4; hand-calculated
ledger and concurrent-sale tests in Phase 7; stale/duplicate/restart alert tests in
Phase 8; isolation/reconnect tests in Phase 10; cold-start/release checks in Phase 12.
