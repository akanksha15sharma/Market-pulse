# MarketPulse documentation

For current setup, supported features, screenshots guidance, and checks, start
with the [project README](../README.md).

## Current operational and feature guides

- [Production deployment, environment variables, and release verification](deployment.md)
- [Database schema, migrations, seeding, and isolated integration tests](database.md)
- [Authentication and account email limitations](authentication.md)
- [Keyless CoinPaprika integration and data availability](live-crypto.md)
- [Market backend, worker, and budgets](market-backend.md)
- [Dashboard and chart behavior](market-ui.md)
- [Private watchlists](watchlists.md)
- [Price alerts and target-reached records](alerts.md)

## Historical design and verification

[Scope](scope.md), [provider comparisons](data-providers.md), [architecture](architecture.md),
and [decision records](decisions/0001-phase-0-baseline.md) contain the original
phase plans. They may describe future or superseded settings; current source,
`.env.example` files, and the deployment runbook define the implemented contract.
Phase verification files in the project root record checks at that stage rather
than proving a production deployment.
