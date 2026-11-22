# ADR 0004 — requested Phase 7 alert scope and real-only evaluation

Status: accepted by the user's explicit request to build price alerts as Phase 7
and stop before Phase 8. The historical roadmap placed portfolios in Phase 7 and
alerts in Phase 8; this request takes precedence for the current implementation.
Approved Phase 0 documents are retained unchanged.

Implement private target management, durable one-event-per-activation evaluation,
and target-reached history. Do not implement paper portfolios, email, notifications
inbox or later-phase delivery mechanisms in this change.

The user also explicitly prohibited triggering from simulated or stale prices.
This supersedes the original planning allowance for demo alerts. Stock targets may
be saved but cannot trigger while stocks have only demo data. Real-only eligibility,
post-arm source/fetch timestamps and freshness are enforced server-side, not left
to UI warnings. Quotes and events use exact decimals and atomic PostgreSQL writes.
