# MarketPulse documentation

For current setup, supported features, screenshots guidance, and checks, start
with the [project README](../README.md).

## Approved public-product direction — documentation steps A1 and A2

These documents distinguish implemented behavior from the intended public release:

- [A2 provider permission research, evidence labels, and recommendation](provider-permissions-a2.md)
- [Proposed free-data implementation steps and diagrams](free-data-implementation-plan.md)
- [ADR 0006: A2 research boundary and follow-up](decisions/0006-a2-provider-permission-review.md)
- [Public product scope and launch gates](scope.md)
- [Current architecture and proposed data paths](architecture.md)
- [Dated provider findings](data-providers.md)
- [Market-data rights acceptance checklist](market-data-rights.md)
- [ADR 0005: scope, cost boundary, and approval sequence](decisions/0005-public-product-scope-and-data-rights.md)

A1 and the user-defined A2 permission review are documentation only. A2 does not
execute the previously proposed baseline activity. Neither step approves a provider
integration, production seeding, migrations, deployment, paid services, or the next
implementation step.

## Current operational and feature guides

- [Free hosting comparison, provider limits, and opt-in background alerts](free-deployment.md)

- [Production deployment, environment variables, and release verification](deployment.md)
- [Database schema, migrations, seeding, and isolated integration tests](database.md)
- [Authentication and account email limitations](authentication.md)
- [Keyless CoinPaprika integration and data availability](live-crypto.md)
- [Market backend, worker, and budgets](market-backend.md)
- [Dashboard and chart behavior](market-ui.md)
- [Private watchlists](watchlists.md)
- [Price alerts and target-reached records](alerts.md)

## Historical design and verification

The [original Phase 0 decision](decisions/0001-phase-0-baseline.md) and older
verification/decision records preserve historical plans. ADR 0005 supersedes their
scope/provider assumptions; scope, architecture, and provider findings are now
current A1 direction. Earlier records may describe superseded settings; current source,
`.env.example` files, and the deployment runbook define the implemented contract.
Phase verification files in the project root record checks at that stage rather
than proving a production deployment.
