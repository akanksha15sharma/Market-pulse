# API comparison and usage strategy

Public primary sources checked 2026-11-22. No account or credentialed API testing.

## Provider decision

| Provider | Published free limits | Decision |
|---|---|---|
| CoinGecko Demo | 10,000 credits/month; 100 requests/minute; attribution required | Selected crypto provider; no free upstream WebSocket assumed |
| Twelve Data Basic | 8 API credits/minute; 800/day; 8 trial WS credits | Conditional stock adapter candidate; disabled by default |
| Alpha Vantage | Standard 25 requests/day | Not selected for frequent quotes |
| Finnhub | Not verified during this review | Not selected; pricing page was unreadable |
| Internal synthetic provider | No external requests | Selected stock baseline and CI provider |

CoinGecko supports batch crypto markets and price history. Confirm applicable
display/storage terms before public release; attribution is mandatory. Demo access
does not establish a general commercial redistribution license.
Twelve Data Basic lists internal non-display usage; neither a private dashboard nor
a public UI is presumed authorized. Credits are weighted by endpoint and symbol;
batching does not necessarily reduce them. Trial WS credits are not a dependable
ongoing streaming entitlement. Enable stock data only after verifying display,
exchange, chart and caching rights for the exact account/use case.
Alpha Vantage's real-time and 15-minute-delayed US stock data are premium. Its
educational/open-source exceptions require provider verification, not assumption.
Do not rely on remembered Finnhub quotas or candle entitlements.

Sources: [CoinGecko pricing](https://www.coingecko.com/en/api/pricing),
[Twelve Data pricing and weights](https://twelvedata.com/pricing),
[Alpha Vantage support](https://www.alphavantage.co/support/),
[Finnhub pricing](https://finnhub.io/pricing).

## Endpoints and capabilities

Server-side CoinGecko Demo base: `https://api.coingecko.com/api/v3`, authenticated
with `x-cg-demo-api-key`. One `/coins/markets` batch covers all ten catalog IDs in USD.
Use `/coins/{id}/market_chart` for requested asset detail ranges. Local catalog search
avoids upstream search per keystroke. No per-row quote or separate trending requests.

Charts: 1D, 7D, 1M (30 days), 1Y (365 days). Demo history is restricted to the past
365 days. Auto-granularity is five-minute for a current one-day range, hourly for
2–90 days and daily above 90 days. These are price series, not OHLC candles.
Validate response contracts and actual account access in Phase 4.
[CoinGecko Demo chart reference](https://docs.coingecko.com/demo/reference/coins-id-market-chart)

## Refresh and caching

| Data | Policy |
|---|---|
| Crypto quote batch | Every 600 seconds while operating; one shared scheduler |
| 1D chart | On demand; fresh cache for 30 minutes |
| 7D/1M chart | On demand; fresh cache for 6 hours |
| 1Y chart | On demand; fresh cache for 24 hours |
| Synthetic stock series | Every 60 seconds while demo is active |
| Browser polling | Every 60 seconds while visible; backend cache reads only |
| Future entitled stock feed | Five-minute regular-session polling; disabled initially |

Real quote stale threshold: source observation older than 20 minutes or missing/
untrustworthy source time. Retain fetched time separately; it does not prove freshness.
Stale quotes cannot trigger alerts. Show stale/unavailable instead of fake replacements.
Cache history provisionally for at most 48 hours, shorter if terms require; no
permanent raw-provider archive. Browser chart refresh is not a provider refresh promise.

## CoinGecko budget: worst-case 31-day month

| Workload | Application ceiling |
|---|---:|
| Quote batches: 31 × 24 × 6 | 4,464 attempts |
| History misses/refreshes: 80/day × 31 | 2,480 attempts |
| Optional metadata maintenance: 1/day | 31 attempts |
| Shared retry/manual integration reserve | 1,025 attempts |
| Total hard application cap | 8,000 attempts |
| Unallocated provider allowance | 2,000 credits |

Conservatively count/reserve every outbound attempt, including errors, against
application budgets; this is not a claim every attempt is provider-billed. All
retries consume the reserve AND total windows. Chart budget is global, not per user.

Enforce provider-wide 10 attempts/minute, 260/day and 8,000/provider billing month.
Enforce category caps too; daily maxima never override monthly or category limits.
Prioritize scheduled quotes over charts. Return stale history or unavailable when
budget is exhausted. Use the actual billing reset, not an assumed calendar month.
Persist counters and next-fetch times so restarts cannot reset quota. Unknown quota
window means live requests remain disabled until configured.
CI and previews use synthetic data. Development with the same key shares the same
budget; reconcile account usage before enabling live traffic.

## Optional stock budget, not enabled

Five symbols × 78 five-minute slots in a normal 390-minute session = 390 one-credit
requests, plus at most five closing refreshes. Application ceiling: 6 credits/minute
and 600/day, including 100 history credits and 105 retries/reference credits. This
assumes one-credit endpoints only: re-evaluate weights and entitlements first.
Pace requests instead of bursting. Use America/New_York and an exchange holiday/
early-close calendar, never a fixed UTC offset. No extended-hours promise.

## Enforcement and outages

- Reserve quota atomically before outbound calls; scheduler lease per provider/time
  slot; deduplicate chart cache misses; serialize upstream calls initially.
- Separate client limits: initial 60 cache reads/minute/client and 6 history
  requests/minute/user, still subordinate to global upstream budgets.
- Ten-second request timeout; at most two budgeted retries for transient timeout/5xx
  failures with exponential backoff/jitter. Never overlap duplicate scheduled jobs.
- Honor 429 Retry-After; otherwise pause at least 60 seconds and increase backoff.
  Daily/monthly exhaustion stops requests until the correct window resets.
- 401/403 disables the affected integration pending correction; no credential loop.
- Repeated failures open a circuit breaker; one budgeted recovery probe.
- Record cache hits, provider attempts, latency, quota remaining and last success.
- No scraping, automatic paid upgrades, key rotation or multiple accounts to evade caps.

## Email

Resend free capacity: 3,000/month and 100/day. Application limits: 2,500/month and
90/day; alerts at most 1,800/month and 60/day, leaving account-email headroom.
All categories share total limits; prioritize verification/recovery and throttle resends.
Initially pace one send request/second and honor response limits. Alert email expires
after 24 hours if deferred; in-app history remains, with explicit delivery status.
Verified sender domain required beyond the account's own test address. Use Mailpit
locally; hosted email disabled until configured. Public demo cannot send arbitrary mail.
[Resend pricing](https://resend.com/pricing),
[Resend restrictions](https://resend.com/docs/api-reference/errors).
