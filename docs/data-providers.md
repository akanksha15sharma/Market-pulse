# Provider findings for the public MarketPulse product

A1 sources reviewed 2026-11-24 through 2026-11-25; extended by the documentation-only
A2 permission review on 2026-11-25. No account was created,
provider contacted, key issued, credentialed API tested, or integration enabled.
This replaces the original provider-selection proposal. The implemented crypto
adapter is CoinPaprika, not CoinGecko. Stocks still use DEMO in current code.

## A2 research update

The [dated A2 report](provider-permissions-a2.md) is the current detailed evidence
record. It distinguishes verified statements, restrictions, and unknown permissions.
The user defined A2 as research, superseding the earlier proposed baseline activity.
No baseline execution, provider registration, or integration is completed here.

Recommend official stock **and crypto** widgets for a constrained free display
release, subject to site and symbol review. CoinMarketCap Basic is a promising
native-crypto clarification candidate because its current pricing advertises free
commercial use; operative terms, retention, history, and alerts remain unconfirmed.
CoinLore API availability and Coinbase public endpoints do not establish our rights.
See the [proposed step-by-step plan](free-data-implementation-plan.md) before asking
for a new implementation approval. No provider is enabled or cleared for the full
native feature set by A2.

## Decision

Prioritize genuine, permitted observations and keep all work within free allowances.
Investigate official free stock and crypto widgets for display first. Do not select
a native stock API until its exact plan permits our public display, caching, history, and
server-side alerts. Existing crypto rights require the same review.

A free endpoint is an access mechanism, not a public redistribution license.
Likewise, attribution, delaying a price, batching requests, or caching it does not
supply missing permission. Read the [rights checklist](market-data-rights.md) before
any implementation decision. No complete native provider is approved by A1 or
this A2 documentation review.

## Evidence register

Limits below are published access limits, not product rights or guaranteed capacity.
Recheck terms and actual account entitlements before any future enablement.

| Provider                     | Reviewed evidence and limits                                                                                                                                                                                                                            | A1 assessment                                                                                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| CoinPaprika                  | [API offering](https://coinpaprika.com/api) lists free personal access, 20,000 calls/month per IP, updates within ten minutes, and separate customer redistribution rights                                                                              | Existing genuine adapter; public distribution remains unapproved without appropriate evidence. Source attribution alone is insufficient              |
| CoinGecko                    | [Licensing guidance](https://support.coingecko.com/articles/1043089972-what-are-the-differences-between-commercial-and-custom-licenses) says Demo does not include commercial rights and distinguishes public display from reusable data redistribution | Not an automatic free replacement; plan, audience, backend delivery, and storage need review                                                         |
| Twelve Data                  | [Business Basic](https://twelvedata.com/pricing-business) lists 8 API credits/minute, 800/day, and internal non-display use; external display access is separately offered                                                                              | Native stock candidate only if suitable no-cost permission is documented. Batch requests can consume credits per symbol/endpoint                     |
| Alpha Vantage                | [Support](https://www.alphavantage.co/support/) lists standard 25 requests/day; real-time and fifteen-minute delayed US data need other entitlements. [Terms](https://www.alphavantage.co/terms_of_service/) default to personal, noncommercial use     | Not cleared for our public service. Verified educational/open-source access does not automatically grant public-use rights                           |
| Finnhub                      | [Terms](https://finnhub.io/terms-of-service) require written approval for sharing data or derived results with third parties; current numeric free quota was not confirmed from a readable primary pricing page                                         | Not selected; do not copy remembered quotas or assume free chart access                                                                              |
| Massive, formerly Polygon    | [Individual terms](https://massive.com/legal/individuals-terms-of-service) govern personal non-business use, including free individual access                                                                                                           | Not cleared for public multi-user use; no native adapter is approved                                                                                 |
| Financial Modeling Prep      | [Pricing and licensing notice](https://site.financialmodelingprep.com/developer/docs/pricing) lists Basic at 250 calls/day and requires a specific data display/licensing agreement                                                                     | Possible permission-request candidate; free access alone does not authorize this app                                                                 |
| TradingView official widgets | [Widget offering](https://www.tradingview.com/widget/) provides free branded embeds. [Data FAQ](https://www.tradingview.com/widget-docs/faq/data/) describes delayed stock availability, symbol restrictions, and no general data API/export facility   | Preferred display-only candidate for later site/widget terms and five-symbol review. No extraction, backend quote cache, or MarketPulse stock alerts |

For widgets, also review [applicable policies](https://www.tradingview.com/policies/)
and [attribution guidance](https://www.tradingview.com/widget-docs/faq/general/).
An official public embed offering is not blanket approval for every site, symbol,
commercial use, or machine-processing purpose.

Exclude unofficial Yahoo scraping, extraction from embedded charts, and bypassing
rate limits. [Yahoo API terms](https://legal.yahoo.com/us/en/yahoo/terms/product-atos/apitnc/index.html)
restrict automated collection outside permitted interfaces. Stooq's public-use
rights and applicable limits were not verified; downloadable CSV alone is not
permission. The [Nasdaq Data Link WIKI notice](https://data.nasdaq.com/databases/WIKIP)
says that feed stopped active support in April 2018, so it cannot supply current
prices. A software library's license does not license its upstream market data.

## Capability comparison

| Data path                           | Genuine display                          | Our native history cache                        | Our stock alert evaluator                                                 |
| ----------------------------------- | ---------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| Reviewed official widget            | Within embed terms and supported symbols | No widget extraction                            | Unavailable                                                               |
| Rights-cleared end-of-day API       | Last-close labels                        | Only permitted daily observations and retention | Closing-price conditions only, if processing is permitted                 |
| Rights-cleared delayed API          | Documented delay labels                  | Only supported intervals and retention          | Delayed conditions only, if processing is permitted                       |
| Unverified free API or scraped feed | Not approved                             | Not approved                                    | Not approved                                                              |
| Current DEMO provider               | Synthetic                                | Synthetic                                       | Already blocked for genuine alerts; excluded from intended public product |

No free native feed has been accepted for the full scope among the sources reviewed.
This is not a claim that no suitable grant can ever exist. An explicit free grant
can change the decision after its scope is checked. A paid-only answer leaves that
capability unavailable unless the user separately changes the no-spend requirement.

## Existing technical behavior, not a license grant

The current CoinPaprika adapter uses fixed HTTPS ticker/history paths, validates
payloads and timestamps, and shares ingestion across users. The engine attempts
real crypto quote batches at ten-minute intervals while operating. Browser polling
reads our backend cache; it does not imply a new provider observation every minute.

Current application ceilings are 10 attempts/minute, 260/day, 8,000/month, and
80 chart attempts/day. They are deliberately lower than published access ceilings.
They do not establish redistribution permission, and multiple environments or
shared egress can consume the same provider allowance.

Current chart cache freshness is thirty minutes for 1D, six hours for 7D/1M, and
one day for 1Y; stored history expires after 48 hours. These implemented settings
are not proof of permitted retention. Future source-specific policies must use the
stricter of the contractual retention limit and the application's cache policy.
Do not create a permanent provider archive without explicit rights.

## Examples for the later implementation

- Five stock rows in a watchlist do not require inventing five prices. Keep the
  identities and show an approved embed or an unavailable state.
- A daily close can support a daily chart if licensed. It cannot justify a
  minute-by-minute native chart or a claim of intraday crossings.
- A chart widget may show Apple while our API has no Apple quote. Keep those
  capabilities separate; do not read its iframe to fill our quote table.
- Five symbols requested in one HTTP call may still cost five credits. Verify
  endpoint weights, reset windows, retries, and history costs before scheduling.
- Re-fetching an old observation changes fetched time, not source time. It cannot
  make that observation eligible for a newly armed alert.

## Permission-request boundary

A future permission request must describe public users, server-to-browser delivery,
five stock symbols, historical display, retention, alert processing, attribution,
and noncommercial/no-cost operation. Ask for the exact allowed datasets and limits.
Do not send a request, accept terms, open accounts, or incur a charge under A1.
Store only a non-sensitive rights summary in Git; keep private contracts and account
identifiers in an appropriate private location.
