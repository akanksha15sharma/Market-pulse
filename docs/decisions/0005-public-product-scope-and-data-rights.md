# ADR 0005 — public product scope and market-data rights

Date: 2026-11-25.
Status: accepted direction under the user's explicit approval of Step A1;
documentation only. A2 and all implementation/production operations need separate
approval. This supersedes the original Phase 0 scope/provider assumptions and the
unchanged-roadmap language, while preserving earlier ADRs as historical records.

## Context

The user wants a useful, genuine-data public application within free allowances.
The code currently has real CoinPaprika crypto, simulated stocks, private accounts
and watchlists, and crypto-specific alert events. Initial architecture documents
mixed intended and implemented features. Free API access does not necessarily
permit public display, backend redistribution, caching, or alert processing.

## Decisions and beginner-friendly reasons

1. **Genuine data or explicit unavailability in the intended public release.** A
   realistic-looking generated price is still simulated. Keep user-owned asset
   references when data is missing. This direction does not remove simulation
   from runtime code in A1; that needs a later approved step.
2. **Remain free.** No paid plan, automatic overage, card-required trial, domain
   purchase, quota evasion, or provisioning is approved. A feature requiring a
   purchase stays unavailable; asking permission is not permission to spend.
3. **Review every dataset and use.** Attribution and cache budgets do not grant
   rights. Apply the same test to existing crypto and proposed stock sources.
4. **Investigate official widgets first for stock display.** An official embed may
   provide a genuine chart without backend data rights. It is a candidate, not a
   selected integration. Its data cannot drive our cache or stock alerts.
5. **Gate native stock integration.** No reviewed standard free API has been
   accepted for the whole target scope. A written no-cost grant can reopen this
   decision after public display, history, storage, and processing are reviewed.
6. **Retain existing architecture and protections.** Keep Vercel, Render, Neon,
   relative API paths, stable asset IDs, hashed sessions, exact origins, CSRF,
   explicit proxy trust, decimal comparisons, and atomic event writes.
7. **Promise only verified features.** Table existence is not a finished inbox or
   delivery service. Account recovery and operating/restore evidence are public
   launch prerequisites. Sleeping free hosts cannot guarantee continuous alerts.
8. **Approve work one step at a time.** A1 documents direction; A2 establishes the
   baseline only after review. Production data operations remain separately gated.

## Consequences

The first release can be smaller but truthful: private watchlists and approved
market displays, with unsupported native stock quotes/alerts labeled unavailable.
Full stock alerts may remain blocked while all costs remain zero. A provider
permission request or commercial hosting change needs a separate instruction.
Existing demo caches, users, lists, and audit records are not deleted or rewritten.

## Alternatives rejected for this scope

- Treating a free HTTP response, open-source client license, or attribution as a
  blanket market-data grant.
- Scraping undocumented endpoints or extracting values from chart widgets.
- Switching to synthetic observations during an outage.
- Paying for an integration or creating artificial traffic to promise uptime.
- Rewriting the working application into microservices or moving user identities
  to another service without a demonstrated need and separate approval.

## Acceptance and follow-up

A1 delivers [scope](../scope.md), [architecture](../architecture.md),
[provider findings](../data-providers.md), [rights checklist](../market-data-rights.md),
and aligned [hosting boundaries](../free-deployment.md). Check Markdown formatting,
local links, diagram structure, and the documentation-only diff before committing.
No live application checks are needed: market GET requests can activate ingestion.

The next request must explicitly approve A2. This ADR grants no A2 execution.
