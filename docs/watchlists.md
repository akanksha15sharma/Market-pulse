# Phase 6 — private watchlists

Watchlists are available to signed-in users at `/watchlists`. Create a named list,
rename it, confirm deletion, add catalog crypto/stocks and remove saved assets.
Lists are saved to PostgreSQL through the Express API. No browser-local list store
or visitor-shared demo account is used. Phase 7 portfolios are excluded.

## API

All paths are under `/api/v1`. All operations require a current cookie session.
Writes also require the existing session-bound CSRF token and matching origin.
Responses use Cache-Control: no-store. Owner identity comes only from the session;
user IDs in bodies and ownership query overrides are rejected.

| Method | Path                           | Input / outcome                                       |
| ------ | ------------------------------ | ----------------------------------------------------- |
| GET    | /watchlists                    | All caller-owned lists and their saved asset metadata |
| POST   | /watchlists                    | `{ "name": "Core ideas" }`; 201 with watchlist        |
| GET    | /watchlists/:id                | One owned list; 200 with watchlist                    |
| PATCH  | /watchlists/:id                | `{ "name": "New name" }`; 200 with watchlist          |
| DELETE | /watchlists/:id                | 204; memberships cascade, catalog assets remain       |
| POST   | /watchlists/:id/items          | `{ "assetId": "UUID" }`; 200 with watchlist           |
| DELETE | /watchlists/:id/items/:assetId | 204; repeat removal is safe on an owned list          |

Public list data contains id, name, createdAt and items. Each item contains public
asset metadata, an available flag and addedAt. User IDs, credentials and provider
mappings are not returned. Unknown and other-user list IDs both return 404.
Malformed IDs/input return 400; invalid sessions 401; CSRF/origin failures 403;
capacity conflicts 409. Read/write budgets are separate, each 60 requests per user
per minute, using the existing persistent auth limiter. 429 includes Retry-After.

Names are trimmed, 1–100 characters, without C0/DEL control characters. Different
lists may have the same display name; their UUIDs identify them. Limits follow the
roadmap: five lists per account and twenty assets per list, including saved inactive
assets. Only active catalog assets can be added. Duplicate additions of an active
asset are idempotent, including at capacity. Removing an absent item is idempotent
once ownership of the list is confirmed.

## PostgreSQL and ownership

The existing watchlists/watchlist_items schema from Phase 2 is sufficient. No schema
or migration is changed. Every read filters by the authenticated user. Every write
runs in an explicit ReadCommitted transaction, locks the caller's users row with
SELECT FOR UPDATE, and checks ownership before touching list membership. This
serializes all watchlist writers for one account across API processes and connection
pools, so count-and-write operations cannot race past five lists or twenty items.
The existing composite membership primary key also prevents duplicate asset rows.

A deleted list cascades its own items. Shared catalog assets and other lists are
preserved. An asset deactivated after saving remains listed with available=false;
it cannot be re-added and its price is shown unavailable, while removal still works.
Names are displayed as escaped React text.

## Prices and UI

The page reuses Phase 5's market panels, responsive table, formatting, provenance
labels, refresh policy and market-error presentation. A single existing `/quotes`
batch supplies the current cached catalog prices, alongside `/assets?limit=15` and
`/market-status`. Watchlist writes never call an upstream market provider.

Public prices poll every 60 seconds while visible. Private lists revalidate on a
successful action, every 60 seconds while visible, and when the tab becomes visible.
Actions use the existing CSRF-aware API client. A 401 from a list load or mutation
redirects to sign-in. No private list cache survives account navigation. Pending
controls are disabled, mutation errors remain visible, empty lists have guidance,
list deletion has an inline confirmation, and list selection is represented in the
URL. Catalog search/type filtering operates locally on the existing curated assets.
Missing prices stay unavailable; simulated stock and crypto quote labels are kept.

## Local setup and checks

Use the existing environment and databases; do not overwrite .env files or reset
application data. Apply any outstanding existing migrations to the application and
test databases as described in [database setup](database.md). No Phase 6 migration
is needed. With the application database configured:

```sh
npm run db:up
npm run db:generate
npm run db:deploy
npm run db:seed
npm run dev
```

Sign in at http://127.0.0.1:5173/login and open /watchlists.

```sh
npm test
npm run lint
npm run format:check
npm run typecheck
npm run build
TEST_DATABASE_URL=postgresql://marketpulse:marketpulse_dev@127.0.0.1:5432/marketpulse_test npm run test:watchlists:db
```

Adjust local credentials/port to your existing setup. The test database must be
marketpulse_test on localhost, 127.0.0.1 or ::1. Tests have no application-URL fallback
and delete only their own synthetic users/assets/rate keys; no broad reset is used.
CI runs the new database suite after existing database/auth/market suites.

Manual acceptance: create and rename lists, save one crypto and one stock, reload
and verify persistence/current-price provenance, remove an asset, cancel and confirm
list deletion, fill five list slots, and check the empty and failure states. Use a
second account to verify private-list isolation and revoke/expire a session to
verify sign-in redirection. Check keyboard access and 375px/desktop layouts.

See [Phase 6 verification](../PHASE6-VERIFICATION.md) for actual results and limits.
