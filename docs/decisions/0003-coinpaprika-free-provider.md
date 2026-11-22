# ADR 0003 — keyless CoinPaprika replaces live CoinGecko

Status: accepted by the user's explicit provider-switch request, before Phase 7.
This supersedes the CoinGecko provider choice for current implementation; the
approved Phase 0 documents are retained as historical planning evidence.

Use only https://api.coinpaprika.com/v1/tickers and its per-coin historical route.
No paid host, key/account, subscriptions or payment flows. CoinPaprika free access
is documented for personal use with 20,000 monthly calls/IP, hourly history over
24 hours and daily history over one year. Sources: [pricing](https://coinpaprika.com/api/pricing),
[tickers](https://docs.coinpaprika.com/api-reference/tickers/get-tickers-for-all-active-coins),
[history](https://docs.coinpaprika.com/api-reference/tickers/get-historical-ticks-for-a-specific-coin).

Keep the application's stricter attempt budgets, shared caches/leases, USD scope,
stock simulation, provenance checks and no-real-to-demo-fallback policy. Free
history restrictions become explicit unavailability with bounded retries. Daily
history is displayed as daily, never interpolated into invented intraday data.

Add a distinct COINPAPRIKA database enum/mappings with additive migrations. Preserve
all asset UUIDs and existing rows; old CoinGecko observations remain historical and
are not served under the new source name. Existing watchlist relationships survive.

Defaults now use coinpaprika; explicit demo remains for offline tests. Billing
windows and provider keys are removed from active configuration. A UTC month is
used for the local application cap. No commercial deployment is part of this change.
