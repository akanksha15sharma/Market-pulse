# A3 — existing application verification baseline

Date: 2026-11-25, Asia/Kolkata. Source revision:
`76a7001f22ca27a7deee39c3ffc3575f5c1aa78b` (the A2 documentation commit).
Working tree was clean before verification. Scope: run existing checks, inspect the
working application with non-destructive operations, and commit documentation only.
No real-data upgrade, unrelated fix, production record change, migration, seed,
provider ingestion job, account creation, or deployment-setting change was performed.

## Result and how to read it

**Partial baseline verified; the database integration baseline is not green.**

- PASS: schema validation, lint, formatting, types, explicit production build,
  offline production preflight, and all 119 existing non-database tests.
- PASS within stated limits: compiled local API HTTP smoke test, live static pages,
  API liveness, read-only database readiness, unauthenticated protection, origin
  rejection, CSRF issuance, and browser rendering/isolated chart interactions.
- BLOCKED: all five database integration commands exited 1 because local PostgreSQL
  was unreachable. Their 28 test cases did not establish their intended behavior.
- UNVERIFIED: production signed-in writes, current catalog/quotes/history, real
  ingestion/evaluation, seed completion, full schema state, and deployment commit.

PASS means the particular observed check passed, not that the whole product is
production-ready. BLOCKED means a missing prerequisite prevented verification;
it is neither a passing test nor evidence of a business-logic bug. UNVERIFIED
means the operation was deliberately excluded or could not be established safely.
No failing check was hidden or fixed during this task.

## Verification layers and execution flow

```mermaid
flowchart TD
    Source[Existing source revision] --> Static[Schema, lint, formatting and type checks]
    Static --> Build[Explicit production build]
    Build --> Unit[Existing fixture and unit suites]
    Build --> LocalAPI[Compiled API with fake database URL]
    Build --> LocalUI[Built frontend with localhost fixtures]
    Source --> Integration[Existing database integration suites]
    Integration --> Blocked[Blocked: localhost PostgreSQL unreachable]
    Live[Live deployment] --> Safe[Static pages and safe API checks]
    Safe --> DB[Read-only readiness SELECT 1]
    Live --> Browser[Anonymous browser with market API interception]
    Unit --> Report[Evidence and limitations]
    LocalAPI --> Report
    LocalUI --> Report
    Blocked --> Report
    DB --> Report
    Browser --> Report
```

A unit/fixture test checks a controlled part of the application. An integration
test checks the real database interaction. A browser test checks the running UI.
These layers complement one another; none substitutes for a missing layer.

## Environment and safety controls

- Node `v22.22.1`, npm `9.2.0`; existing installed dependencies were used.
- Standard local checks used explicitly fake `DATABASE_URL` and
  `DIRECT_DATABASE_URL`: `postgresql://example.invalid/marketpulse`.
- Local checks disabled the worker and account mail; no production secrets were
  inspected or copied. Test-only origin and CSRF secret were synthetic values.
- Integration commands explicitly set all three database URL variables to the
  local `marketpulse_test` database. They did not inherit a Neon target.
- Live requests were GETs without an account session. CSRF output was reduced to
  token-presence and cookie-flag booleans; token/cookie values were not recorded.
- Browser verification used fresh anonymous profiles, not the user's browser or
  stored login. Production market API calls were intercepted before transmission.
- Temporary harnesses, raw logs, browser profiles, and screenshots stayed under
  `/tmp/marketpulse-a3`, outside the repository. Local test processes were stopped.
- Builds generated ignored artifacts; tracked application source was unchanged.

The live reads may wake hosting/database compute and produce normal access logs.
No business-record write or settings update was intentionally invoked.

## 1. Existing static checks and production build

Purpose: catch malformed schema, code-quality errors, incompatible types, and
build failures before attempting a market-data upgrade.

| Command                                                            | Result       | Meaning and limit                                                                                               |
| ------------------------------------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------------------- |
| `npm run db:validate`                                              | PASS, exit 0 | Prisma schema/configuration is structurally valid; this does not query the database                             |
| `npm run lint`                                                     | PASS, exit 0 | Existing ESLint rules accept the source                                                                         |
| `npm run format:check`                                             | PASS, exit 0 | Repository formatting check passes                                                                              |
| `npm run typecheck`                                                | PASS, exit 0 | Contracts, frontend, API, Prisma tools, and tests type-check                                                    |
| `NODE_ENV=production npm run build`                                | PASS, exit 0 | Contracts, compiled API, and Vite production frontend build successfully                                        |
| `npm test`                                                         | PASS, exit 0 | All 119 existing fixture/unit tests pass                                                                        |
| `npm run production:check` with synthetic production configuration | PASS, exit 0 | Compiled preflight accepts a valid production-shaped configuration without connecting to a database or provider |

For reproducibility, run checks from the repository root. Local checks used this
kind of isolated configuration, not real credentials:

```bash
export DATABASE_URL=postgresql://example.invalid/marketpulse
export DIRECT_DATABASE_URL=postgresql://example.invalid/marketpulse
export APP_ORIGIN=https://marketpulse.example
export EMAIL_MODE=disabled
export MARKET_WORKER_ENABLED=false
export MARKET_ALWAYS_ON=false
# Use a test-only 64-character CSRF_SECRET, never the production secret.
# Set NODE_ENV=test for unit checks and explicitly production for the build/preflight.
```

`typecheck` regenerates the ignored Prisma client. The build generates ignored
`dist` files. Neither command applies migrations or seeds data.

### Build-environment correction

The first build succeeded but inherited `NODE_ENV=test` from the isolated check
runner. Its frontend entry chunk was about 708.70 kB and differed from production.
That run was not accepted as the final production artifact evidence.

The build was repeated with `NODE_ENV=production`, passed, and produced:

- Entry JavaScript: `index-OxNrq6h4.js`, 466.83 kB / 140.50 kB gzip.
- Lazy chart chunk: `HistoryChart-Bq0TC6Zj.js`, 5.77 kB / 2.35 kB gzip.
- CSS: `index-Cjc3jgRs.css`, 27.84 kB / 6.72 kB gzip.

Local browser chart checks were repeated against that corrected build. This was
a correction to the verification setup, not an application change or a production
performance claim.

## 2. Existing non-database tests

The command is `npm test`; it runs the existing suites in sequence. Provider calls,
service records, and browser fetches in these tests use controlled fixtures.
They do not prove live provider permission, live freshness, or PostgreSQL locking.

| Suite          |  Passed | Representative behavior verified                                                                                                        |
| -------------- | ------: | --------------------------------------------------------------------------------------------------------------------------------------- |
| Deployment     |       4 | API rewrite order/target, SPA fallback, cache/security configuration, guarded workflow                                                  |
| Configuration  |       5 | Production origin/secret checks, proxy validation, port/input handling, safe preflight                                                  |
| Seed lifecycle |       2 | Warm-up before one atomic transaction, latency budgets, cleanup and failure propagation                                                 |
| Authentication |      10 | Password verification, cookies, CSRF/session rotation, origin checks, protected routes and rate-limit behavior                          |
| Frontend       |      58 | Account/list/alert clients and rendering, chart geometry/controls, provenance, stale/pending/errors, polling, cancellation and cooldown |
| Market backend |      25 | Catalog routing, strict query validation, provider normalization, shared quotas/leases, stale data, history queue, one-shot lifecycle   |
| Watchlists     |       7 | Ownership, CSRF, limits, idempotent HTTP behavior with fixture services, safe errors                                                    |
| Alerts         |       8 | Decimal thresholds, real-only and post-arm eligibility, private HTTP management and CSRF                                                |
| **Total**      | **119** | **Zero failures in this command**                                                                                                       |

The chart tests cover flat/irregular data, keyboard control markup, exact-value
tables, timestamps, unsupported/unavailable states, and mode mismatches. Alert tests
reject simulated stock and crypto observations, old/future/replayed observations,
and invalid ownership/input. Real SQL transaction guarantees require the separate
integration suites below.

## 3. Database integration checks — blocked

Purpose: exercise Prisma, actual PostgreSQL constraints, durable records, and
concurrent transactions rather than fixture behavior.

Preparation findings:

- `docker ps --format '{{.Names}}'` returned permission denied for the Docker socket,
  including the explicitly permitted out-of-sandbox attempt.
- No local `initdb` or `/usr/lib/postgresql` installation was found.
- A TCP probe to `127.0.0.1:5432` returned connection refused.

The suites were still attempted against the explicitly isolated local URL:

```bash
export TEST_DATABASE_URL=postgresql://marketpulse:marketpulse_dev@127.0.0.1:5432/marketpulse_test
export DATABASE_URL="$TEST_DATABASE_URL"
export DIRECT_DATABASE_URL="$TEST_DATABASE_URL"

npm run test:db
npm run test:auth:db
npm run test:markets:db
npm run test:watchlists:db
npm run test:alerts:db
```

These are repository-local development credentials, not production credentials.
The commands were run independently so one failure did not hide the others.

| Command                      | Exit | Cases failed/blocked | Recorded prerequisite failure                   |
| ---------------------------- | ---: | -------------------: | ----------------------------------------------- |
| `npm run test:db`            |    1 |                    4 | Can't reach database server at `127.0.0.1:5432` |
| `npm run test:auth:db`       |    1 |                    5 | Same local database failure                     |
| `npm run test:markets:db`    |    1 |                    6 | Same local database failure                     |
| `npm run test:watchlists:db` |    1 |                    6 | Same local database failure                     |
| `npm run test:alerts:db`     |    1 |                    7 | Same local database failure                     |

**All 28 integration cases remain unverified.** Failures prevented establishing
seed idempotency on actual PostgreSQL, persistent sessions/recovery, ownership
queries, market persistence, and concurrent alert guarantees. Passing unit tests
must not be used to mark these database behaviors green.

No container privileges, databases, migrations, or seeds were changed to work around
this prerequisite. Next verification needs a reachable isolated local/test database,
then the existing migrations and suites in a separately approved follow-up. Do not
point the tests at Neon production or run reset commands on valued records.

## 4. Compiled backend HTTP smoke test

Purpose: establish that the built application starts as an HTTP server rather than
only passing imported-module tests.

A temporary harness ran `npm start` with production mode, `HOST=0.0.0.0`, port
`19311`, a synthetic HTTPS APP_ORIGIN/CSRF secret, fake database URLs, disabled mail,
and disabled market worker. It waited for the listening message, made requests,
then sent SIGTERM to its own process group and waited for exit.

| Request to localhost                                | Result                                          |
| --------------------------------------------------- | ----------------------------------------------- |
| `GET /api/v1/health/live`                           | 200                                             |
| `GET /api/v1/auth/me`, no session                   | 401                                             |
| `GET /api/v1/watchlists`, no session                | 401                                             |
| `GET /api/v1/alerts`, no session                    | 401                                             |
| Identity request with untrusted Origin              | 403                                             |
| Identity request with configured Origin, no session | 401, origin accepted but session still required |
| `GET /api/v1/auth/csrf`                             | 200 and a token present; value discarded        |

This confirms compiled startup, listener operation, middleware order, and negative
access behavior without any real database. It cannot confirm signed-in persistence.

## 5. Live deployment checks — non-destructive subset

Frontend: `https://market-pulse-five-sand.vercel.app`.
Backend: `https://market-pulse-r246.onrender.com`.

The main HTTP checks ran 2026-11-24 18:50:52–18:51:04 UTC, which is
2026-11-25 00:20:52–00:21:04 in Asia/Kolkata. Browser/static-asset checks followed
in the same verification session. These are point-in-time results, not an uptime
measurement or a future guarantee.

### Why production market reads were excluded

```mermaid
flowchart TD
    Request[Proposed production request] --> Review[Inspect route and service behavior]
    Review --> Safe{No application record writes expected?}
    Safe -->|Yes| Probe[Static, health, CSRF or unauthenticated guard check]
    Safe -->|No| Exclude[Do not transmit production request]
    Exclude --> Local[Test fixture or isolated local path]
    Probe --> Evidence[Record status and safe metadata]
```

The public market router increments persisted rate limits before returning data;
market services can activate ingestion, and history requests can enqueue jobs.
Calling `/assets`, `/quotes`, `/market-status`, or `/assets/:id/history` is therefore
not a strictly read-only production verification operation. This task skipped them.

Readiness runs `SELECT 1` according to the inspected route; it does not migrate,
seed, write a health record, or start the market worker. The auth/list/alert requests
below had no session token and reject before persistent user rate limiting. CSRF
issuance creates a transient client cookie, not a database record; its value was
not retained. No production POST/PATCH/DELETE or signed-in GET was performed.

### Live results

| Request/check                                                            | Result                               | What it establishes                                            |
| ------------------------------------------------------------------------ | ------------------------------------ | -------------------------------------------------------------- |
| Frontend `/`                                                             | 200, HTML with React root and script | Static document delivery                                       |
| Frontend `/markets`                                                      | 200, same SPA document               | Deep-link fallback works                                       |
| Frontend `/login`                                                        | 200, same SPA document               | Login route deep-link fallback works                           |
| Render `/api/v1/health/live`                                             | 200, `status: ok`                    | API process answers                                            |
| Vercel `/api/v1/health/live`                                             | 200, `status: ok`                    | API rewrite reaches the backend                                |
| Render `/api/v1/health/ready`                                            | 200, `status: ok`; about 3.28 s      | Render can query its configured PostgreSQL database            |
| Vercel `/api/v1/health/ready`                                            | 200, `status: ok`; about 1.15 s      | Same database-readiness route works through the rewrite        |
| Vercel `/api/v1/auth/me`, no session                                     | 401                                  | Identity is not disclosed anonymously                          |
| Vercel `/api/v1/watchlists`, no session                                  | 401                                  | Private lists are not returned anonymously                     |
| Vercel `/api/v1/alerts`, no session                                      | 401                                  | Private alerts are not returned anonymously                    |
| Vercel `/api/v1/auth/csrf`                                               | 200, token present                   | Anonymous CSRF preparation endpoint is reachable               |
| Identity request with untrusted Origin/cross-site metadata               | 403                                  | Origin rejection is active                                     |
| Identity request with production Origin/same-origin metadata, no session | 401                                  | Production Origin is accepted; authentication remains required |

Example successful health response:

```json
{ "status": "ok", "service": "marketpulse-api" }
```

Readiness verifies database reachability, not the intended Neon branch identity,
table contents, migration status, write privileges, backup, or seed completion.
No production connection string or database credential was retrieved or supplied
to the verification tools; readiness used the API's existing server-side
configuration. Host account settings were not inspected.

Sample reproducible safe checks, performed once rather than as keep-alive polling:

```bash
curl -sS -i https://market-pulse-r246.onrender.com/api/v1/health/live
curl -sS -i https://market-pulse-five-sand.vercel.app/api/v1/health/live
curl -sS -i https://market-pulse-five-sand.vercel.app/api/v1/health/ready
curl -sS -i https://market-pulse-five-sand.vercel.app/api/v1/auth/me
```

A 401 is the expected successful protection result for the last command, not a
healthy user's login failure. Do not share raw Cookie/Set-Cookie or CSRF values.

### Headers and browser artifact

The proxied API responses inspected had `Cache-Control: no-store`, CDN no-store,
HSTS, nosniff, DENY frame protection, and a no-referrer policy. They did not carry
wildcard Access-Control-Allow-Origin. The CSRF cookie had __Host naming, Secure,
HttpOnly, SameSite=Strict, and Path=/; the cookie value was discarded. Actual
production session-cookie issuance was not tested because login writes records.

Static HTML returned `Access-Control-Allow-Origin: *`; this was not present on the
checked API responses. Record this distinction rather than claiming private APIs
have permissive CORS or changing an unrelated deployment setting.

The live entry asset `/assets/index-OxNrq6h4.js` returned 200, JavaScript content,
and 466,833 bytes. After the corrected production build, its bytes exactly matched
the local entry artifact. SHA-256:

```text
c79026aaf678cd13c0217fe43b9463db38e9d9f0a40cc0e702447d7355f51dca
```

This confirms this frontend artifact, not every lazy asset or the backend commit.
No deployment SHA was obtained from host settings or response metadata.

## 6. Browser frontend and chart verification

### Live anonymous browser, market requests intercepted

A fresh headless Chrome profile loaded the production frontend. Before navigation,
Chrome DevTools Protocol interception was enabled for production `/api/*` requests.
All such calls were failed locally before transmission. The intercepted paths
were `/api/v1/assets`, `/api/v1/quotes`, and `/api/v1/market-status`.

Observed results:

- Desktop 1280×900: Markets heading/navigation and visible retryable error state.
- Desktop: login page renders labeled Email and Password inputs without an alert.
- Mobile 390×844: Markets renders without document-level horizontal overflow.
- No uncaught runtime exceptions were captured in these tested paths.

The Markets error in this browser run was deliberately induced by interception.
It is not evidence that the real production market endpoint failed. This test
verifies UI loading/failure handling without writing rate-limit or market records.
It does not verify the current live asset count or prices.

### Local built frontend with explicit synthetic test fixtures

A temporary localhost server served `apps/web/dist` on `127.0.0.1:19312`. Its API
routes returned one clearly simulated stock fixture and three history observations.
It had no database client, production API target, or provider adapter. The prices
were isolated test inputs, not actual market observations or production changes.

```mermaid
sequenceDiagram
    participant C as Anonymous Chrome
    participant S as Local built frontend and fixture server
    C->>S: Load Markets and asset detail
    S-->>C: Built JavaScript and controlled DEMO fixtures
    C->>C: Render cards, SVG chart and observation table
    C->>C: Focus slider and send ArrowLeft
    C->>S: Select 7D and request history after client pacing
    S-->>C: Controlled 7D response
    C->>C: Show selected range and new granularity
```

Repeated against the explicit production build, the results were:

| Check                                                                 | Result                     |
| --------------------------------------------------------------------- | -------------------------- |
| Markets renders fixture asset, controls and simulation labels         | PASS                       |
| Asset detail loads the lazy SVG chart                                 | PASS on desktop and mobile |
| Accessible table contains all three supplied observations             | PASS on desktop and mobile |
| Native keyboard ArrowLeft changes slider index 2 to 1                 | PASS on desktop and mobile |
| Changing 24H to 7D updates the selected control                       | PASS on desktop and mobile |
| Paced `history?range=7D` response renders with 1h fixture granularity | PASS on desktop and mobile |
| Document-level horizontal overflow at tested widths                   | None observed              |
| Uncaught runtime exceptions in the exercised paths                    | None captured              |

Screenshots and DOM state were inspected locally. This is a frontend interaction
check, not an end-to-end test against the actual API/database. A synthetic fixture's
status is not a claim about current provider freshness. Broader accessibility,
contrast, all responsive sizes, pointer interactions, and real chart availability
remain outside this browser sample.

Temporary harness commands used Node scripts under `/tmp/marketpulse-a3` for live
HTTP checks, compiled-server smoke, intercepted browser checks, fixture hosting,
and chart interactions. They are not installed application scripts or new test
coverage. The existing committed suites and commands above remain the reproducible
regression checks. Temporary servers and anonymous browser processes were closed.

## 7. Feature verdicts and remaining gaps

| Feature                | Verified evidence                                                  | Remaining limitation                                                                       |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Frontend routing       | Live static deep links and Chrome rendering                        | All routes/full browser workflow not exhaustively tested                                   |
| Backend startup        | Actual compiled local listener; live health                        | Backend deployed SHA/configuration not inspected                                           |
| Database connectivity  | Live direct/proxied read-only readiness                            | Local integration blocked; branch, migrations, record counts and writes unverified         |
| Authentication         | 10 unit tests, live anonymous guards/CSRF, login UI                | Real account registration/login/logout, persistent sessions and recovery not performed     |
| Watchlists             | 7 unit tests, frontend tests, live anonymous 401                   | Persistent CRUD/concurrency integration blocked; no production lists accessed              |
| Charts                 | Existing frontend tests and isolated keyboard/range browser checks | Native live series and provider history not queried                                        |
| Alerts                 | 8 unit tests plus frontend tests; live anonymous 401               | Durable/concurrent SQL checks blocked; no live alert created, armed, or evaluated          |
| Seed                   | Lifecycle unit checks                                              | Real production seed completion and idempotent rerun not verified                          |
| Worker/cache           | Existing mocked engine and one-shot tests                          | No live worker batch, quota counters, or provider request performed                        |
| Genuine data readiness | Current code and A2 evidence remain available                      | Stocks still simulated; licensing, account recovery, and free-host monitoring gates remain |

Production account-email delivery, notification inbox, and alert-email delivery
are not implemented according to the inspected source; no actual email was sent.
Stock alerts remain intentionally ineligible for real triggering. No unrelated
issue was repaired to make this report appear green.

## Follow-up and approval boundary

Before claiming a complete baseline, make an isolated PostgreSQL test environment
available and rerun all five integration suites. Review any remaining failures
rather than testing against production. Persistent user workflows can then be
verified on isolated staging. This report does not authorize infrastructure changes,
production test accounts, migrations, catalog seeding, or live provider ingestion.

If later production market verification is desired, approve its known rate-limit,
cache, queue, and worker side effects explicitly. No continuous probe/keep-alive
was configured. The real-market-data upgrade has not started.

A3 ends with this documentation commit and push. Wait for the user's next explicit
approval before changing application code, resolving prerequisites, or implementing
any A2 proposal. See [A2 research](provider-permissions-a2.md) and
[the implementation proposal](free-data-implementation-plan.md) for context.
