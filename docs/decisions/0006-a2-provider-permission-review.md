# ADR 0006 — A2 permission research and free display recommendation

Date: 2026-11-25.
Status: accepted research scope under the user's explicit A2 request; documentation
only. Recommendations below are not authorization to implement or enable a provider.

## Scope clarification

ADR 0005 proposed baseline verification as A2. The latest user instruction instead
approves researching stock/crypto permissions, official widgets, storage, charts,
and alerts, with documentation, validation, commit, and push only. This instruction
supersedes that proposed activity. Baseline execution remains pending separate
approval; no application code, database, or deployment settings change in A2.

## Decision and reasons

1. Recommend official TradingView stock and crypto embeds as the first completely
   free display path. They provide genuine provider-managed displays without
   representing their values as a native MarketPulse feed. Site terms and exact
   symbol/delay/venue/currency verification still precede any production release.
2. Keep private watchlists and accounts on the current Vercel/Render/Neon stack.
   Preserve the existing session, exact Origin, CSRF, CORS, and ownership protections.
3. Do not extract widget values or claim native chart, cache, or alert permission.
   The free display product has a smaller feature set than the full native target.
4. Treat CoinMarketCap Basic as the first native-crypto clarification candidate:
   the current official pricing positively advertises free commercial integration.
   Its operative agreement was not available through the linked URL in this review;
   payment-free signup, retention, history, and alert scope are not established.
   This updates the research, not the installed provider or its credentials.
5. Do not treat CoinLore's public API description as an override of its restrictive
   general terms. Do not assume exchange APIs such as Coinbase permit outside users.
6. Keep existing CoinPaprika public use unresolved; no ordinary free native stock
   plan reviewed has cleared all requirements. Clear a capability or leave it
   unavailable. No paid upgrade, scraping, or silent simulation is a fallback.
7. Distinguish verified source statements, restrictions, unknowns, and engineering
   recommendations. Published access and numeric quotas are not account approval.
8. Stop after this documentation step. No accounts, provider communications,
   staging implementation, production operations, or next step is authorized.

## Evidence and implementation follow-up

The [research report](../provider-permissions-a2.md) records primary sources and
uncertainty, including the distinction between current pricing and inaccessible
operative terms. The [proposed implementation plan](../free-data-implementation-plan.md)
includes architecture, data flows, candidate files, security checks, testing,
staged release, and rollback. No native alert capability is approved merely by
adding a source to a document or obtaining an API key.

For a beginner: displaying a hosted chart is like displaying a provider-controlled
window. Saving a stock to a private list stores its identity. Neither operation
means our server owns a reusable stream of that chart's prices.

## Consequences

A useful no-cost display release remains possible if the embed checks pass, while
native prices/history/alerts may remain unavailable. If a free native permission
is later established, preserve stable IDs, source-specific cache identities,
atomic/idempotent writes, and old event evidence through reviewed migrations.
The current app, simulated stocks, crypto source, schema, and runtime settings
remain unchanged. A2 neither proves the production baseline nor removes launch
gates such as account recovery and free-hosting monitoring limitations.

Validate documentation scope, formatting, local links, diagram structure, and
source attribution. Commit/push this research only, then wait for the next explicit
approval rather than starting an implementation step automatically.
