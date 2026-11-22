# Phase 7 — real-data price alerts

The user explicitly requested price alerts as Phase 7, ahead of the original
portfolio/alerts ordering. This implementation follows that request and stops
before further phases; see [ADR 0004](decisions/0004-price-alerts-phase-7.md).

Signed-in users manage alerts at /alerts. They can choose crypto or stocks, save
an inclusive at-or-above / at-or-below USD target, pause, edit, rearm, delete and
inspect paginated target-reached history. Ten alerts may be active per user.

## Real observations only

Stock targets can be saved and managed, but stocks currently have only simulated
data. Such alerts are visibly blocked and never trigger. The evaluator also rejects
any demo-only/inactive asset, demo crypto mode/source, unsupported provider, paused
or already-triggered activation. This release does not implement a real stock feed.

A new observation must be an accepted, newer COINPAPRIKA/REAL quote from the existing
market pipeline. Source and fetched times must both be strictly after armedAt,
non-future according to the database clock, and no older than twenty minutes.
Source time cannot exceed fetched time. Historical chart points and cache reads
never evaluate alerts. The exact source quote must meet >= or <= using decimal
arithmetic; JavaScript floating-point comparison is not used.

If a target is already satisfied when saved/rearmed, the next eligible observation
can trigger it. Existing cached prices cannot immediately trigger a new activation.
There is one event per activation. Restart, duplicate ingestion and older source
timestamps cannot create a second event or trigger from a replayed quote.

Evaluation only happens while the market worker ingests quotes. Sleeping/stopped
hosts can miss observations, and the application does not reconstruct missed
crossings. Browser lists/history refresh every sixty seconds while visible and
revalidate after actions; there is no delivery-time guarantee. Email delivery,
notifications inbox, sockets and paper portfolios are outside this change.

## API and ownership

All endpoints are under /api/v1 and require a current authenticated session. Writes
also use the existing session-bound CSRF token and origin checks. Owner identity
comes only from the session. Responses are no-store, inputs are strict, and the
existing persistent limiter enforces separate sixty reads/writes per user/minute.
Foreign alert IDs and unknown IDs both return 404, including event history.

| Method | Path               | Input / outcome                                                                           |
| ------ | ------------------ | ----------------------------------------------------------------------------------------- |
| GET    | /alerts            | Optional status=ACTIVE/PAUSED/TRIGGERED, page, limit (max 50); alerts, total, activeCount |
| POST   | /alerts            | assetId UUID, direction ABOVE/BELOW, threshold decimal string; 201 with alert             |
| GET    | /alerts/:id        | Owned alert with asset, eligibility and latest event                                      |
| PATCH  | /alerts/:id        | direction and threshold; saves target and pauses the alert                                |
| POST   | /alerts/:id/pause  | Empty body; active becomes paused                                                         |
| POST   | /alerts/:id/rearm  | Empty body; paused/triggered becomes active, increments activation and resets armedAt     |
| DELETE | /alerts/:id        | Deletes the alert and its own history, with UI confirmation                               |
| GET    | /alerts/:id/events | Owned paginated immutable observation/target snapshots                                    |

Repeated rearming of an already-active alert is idempotent. Create/rearm reject
capacity conflicts and duplicate active asset/direction/target combinations with 409. Targets must be positive canonical USD decimal strings, at most twenty integer
and eighteen fractional digits, compatible with numeric(38,18). Prices, source,
mode, status, activation, ownership and event timestamps are never caller-selected.
The asset is fixed after creation. Inactive assets cannot be newly added or rearmed.

Editing always pauses the alert. Arm it again to apply the new target; historical
events retain the old target/direction, observed price, source, fetched time and
trigger time. Legacy events without these audit fields are marked unverified and
are not advertised as verified real target-reached events.

## PostgreSQL safety

Existing price_alerts and alert_events tables are reused. Additive migration
20261123000600_alert_event_provenance adds nullable audit fields to preserve legacy
records, plus a constraint validating new real-source, fresh, target-reaching
snapshots. Existing applied migrations are unchanged.

Management writes serialize on the caller's users row and then the owned alert
row, in ReadCommitted transactions, so concurrent create/rearm cannot exceed ten
active alerts. Evaluators lock matching alert rows in stable order. Pausing/editing
and evaluation therefore serialize; a paused alert cannot be evaluated after its
pause commits. The existing unique (alertId, activation) event key prevents duplicates.

Quote cache writes retain their atomic newer-source guard and stable quote lock
order. Only accepted newer rows are evaluated. The cached price, alert transition
and event snapshot commit together in that same transaction; a failure rolls them
all back. The evaluation clock is read after acquiring the alert locks. Existing
market quotas, public-provider requests and worker scheduling are unchanged.

## Local setup and acceptance

Merge changes into the existing checkout; do not reset databases or overwrite .env.
Apply the additive migration to both the configured application database and the
local test database before accepting this feature:

```sh
npm run db:up
npm run db:generate
npm run db:validate
npm run db:deploy
DATABASE_URL=postgresql://marketpulse:marketpulse_dev@127.0.0.1:5432/marketpulse_test DIRECT_DATABASE_URL=postgresql://marketpulse:marketpulse_dev@127.0.0.1:5432/marketpulse_test npm run db:deploy
TEST_DATABASE_URL=postgresql://marketpulse:marketpulse_dev@127.0.0.1:5432/marketpulse_test npm run test:alerts:db
npm test
npm run lint
npm run format:check
npm run typecheck
npm run build
npm run dev
```

Adjust credentials/ports to the existing setup. Database tests refuse remote or
application databases, create only synthetic fixtures and clean only their own data.
CI runs the new suite alongside existing database tests.

Sign in and visit /alerts. Save crypto and stock targets, verify stock blocking,
edit/pause/rearm, inspect history, cancel/confirm deletion and check another account
cannot access private records. Inspect keyboard access and narrow/desktop layouts.
Use fixture tests for stale/demo/future/replay/concurrent scenarios rather than
consuming real API quota to force failures. See [Phase 7 verification](../PHASE7-VERIFICATION.md).
