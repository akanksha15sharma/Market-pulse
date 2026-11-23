# A $0 MarketPulse deployment plan

Researched against official provider documentation on 2026-11-23. This is a
personal/noncommercial, low-traffic deployment plan, with **best-effort background
alerts**. It is not a promise of uninterrupted availability or immediate alerts.
No services, credentials, paid plans, deployments, or ingestion jobs have been enabled.

## Recommendation

| Component         | Choice                                          | Why it fits this codebase                                                                |
| ----------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Frontend          | Vercel Hobby, static Vite build                 | Keeps the UI available independently of backend sleep; free `vercel.app` domain          |
| Backend           | One Render Free Node web service                | Runs Express and existing authentication without a serverless rewrite                    |
| PostgreSQL        | Neon Free                                       | Persistent PostgreSQL for the existing Prisma schema and user data                       |
| Authentication    | Existing MarketPulse sessions stored in Neon    | No additional auth vendor, MAU subscription, user migration, or identity changes         |
| Prices/history    | Existing keyless CoinPaprika integration        | Reuses approved quotas and explicit real/simulated/unavailable labeling                  |
| Background alerts | Optional public-repository GitHub Actions batch | Fetches/evaluates observations directly while the API sleeps; nominally every 30 minutes |

Keep the API's existing bounded, on-demand worker for active visitors. Keep the
standalone always-on worker available for other environments, but do not provision
a paid Render worker or enable continuous database polling in this free profile.
All existing pages, time ranges, favorites, private lists, target management, and
alert records remain available. Free hosting changes availability and sampling
frequency, not their data model or ownership rules.

## Verified free-tier constraints

### Vercel

Hobby currently includes 100 GB fast transfer, 10 GB origin transfer, and one
million CDN requests. Usage caps can pause service; Hobby is for personal,
noncommercial use. API proxying consumes transfer too. Legacy Hobby cron permits
only daily execution, unsuitable for these alerts. We therefore use no Vercel
function or cron for ingestion. [Hobby limits](https://vercel.com/docs/plans/hobby),
[use restrictions](https://vercel.com/docs/limits/fair-use-guidelines),
[cron limits](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing).

### Render

Free web services idle after 15 minutes without incoming traffic and can take
about a minute to wake. A workspace has 750 free instance-hours/month. The disk
is ephemeral, so all durable state stays in PostgreSQL. Free PostgreSQL expires
in 30 days; use Neon instead. Free web services are not a continuous-worker
availability guarantee and have no one-off-job or shell access.

Without a payment method, excess transfer suspends free services and exhausted
build minutes disable new builds; with a payment method, supplementary charges
can apply. Confirm account billing controls before launch. Avoid synthetic uptime
pings: the optional scheduler performs ingestion directly, not web keep-alives.
[Render Free documentation](https://render.com/docs/free).

### Neon

Free currently provides 100 CU-hours, 1 GB PostgreSQL storage, and 5 GB public
transfer per project/month. Idle compute suspends after five minutes. Exhausted
compute/transfer suspends the database until the next allowance period; storage
limits block growth. Keep the account on Free, rather than a usage-billed plan.
[Neon pricing and limit behavior](https://neon.com/pricing).

At the default 0.25 CU, continuously active compute for 31 days would require
`0.25 × 744 = 186 CU-hours`, exceeding the free allowance. A 30-minute batch with
five minutes of idle tail each time has an idealized baseline of about
`0.25 × (5/30) × 744 = 31 CU-hours`, **before** batch execution time, visitors,
build/release access, retries, and autoscaling. This is planning arithmetic, not a
measured capacity guarantee. Do not poll database readiness every few seconds:
that alone can keep compute active. Watch actual usage and source freshness.

### GitHub Actions

Standard hosted runners in public repositories are free. Private runner usage
has separate allowances/charges, so this workflow refuses private repositories.
It uploads no artifacts and configures no persistent Actions cache. Scheduled
runs can be late or dropped, run only from the default branch, and public-repo
schedules can be disabled after 60 days of inactivity. This is not an SLA-backed
scheduler. [Runner billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
[schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

### Prices and authentication

CoinPaprika Free currently advertises keyless access, 20,000 requests/month per
IP, 2,000 assets, and one year of daily prices for personal use. Shared egress IPs
and provider restrictions can still cause throttling or unavailable history.
MarketPulse's tighter persisted budgets remain unchanged; no plan is upgraded and
no unavailable real history becomes synthetic. Stocks remain explicitly simulated.
[Provider plan](https://coinpaprika.com/api/pricing),
[historical endpoint](https://docs.coinpaprika.com/api-reference/tickers/get-historical-ticks-for-a-specific-coin).

Existing registration, login, cookies, CSRF protection, session revocation, and
private resource ownership continue to use the API and database. There is no new
hosted-auth subscription. Production recovery/verification email and alert email
were not implemented previously and remain unavailable; Mailpit is still supported
locally. Do not promise hosted account-recovery email or email notifications. A
future managed-auth migration would need a separate identity/data migration review.

## What background alerts mean here

The opt-in workflow runs at minutes 17 and 47 each hour, in UTC. A run:

1. Installs and builds the existing contracts and API without database credentials.
2. Receives only the runtime database secret in the ingestion step.
3. Runs `npm run worker:once`, fetching due quotes, evaluating eligible targets
   transactionally, servicing at most the existing four pending chart jobs, and
   performing normal cleanup.
4. Disconnects from PostgreSQL and exits. It starts no HTTP server or interval loop.

The same persisted leases, source freshness, quotas, and duplicate-event protections
coordinate API and batch workers. Failed batches return a failure status and close
their database connection. Provider deferrals/backoffs remain persisted behavior;
a completed batch does not imply every provider request succeeded.

New post-arm, fresh real observations can trigger targets without an open browser.
A crossing that happens and reverses between samples can be missed. Delayed runs,
Neon suspension, provider failures, or quota exhaustion can postpone evaluation.
Stock/demo observations remain ineligible. A cached quote can become stale between
batches, and the UI continues to say so. Guaranteed continuous/immediate alerts
cannot be promised on this $0 stack. No always-on worker capability is removed.

## Files prepared for review

| File                                | Purpose                                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `deploy/vercel.example.json`        | Static build, same-origin API rewrite, SPA fallback, no proxy caching, Git auto-deploy disabled |
| `deploy/render.example.yaml`        | One free API service, no paid worker/database, auto-deploy off, secrets entered separately      |
| `.github/workflows/free-alerts.yml` | Disabled-until-opted-in public-repository batch with concurrency and timeout bounds             |
| `npm run worker:once`               | One ingestion/evaluation batch, then close connections                                          |
| `npm run test:deployment`           | Regression checks for template boundaries and workflow opt-in/billing guards                    |

These example files are not active root deployment configuration. Creating/importing
services, copying an active configuration, enabling the scheduler, or adding host
secrets requires approval. The Render template has no automatic migration/seed
command. The Vercel template deliberately uses `api.example.invalid`, which must
be replaced with an approved Render origin before deployment.

## Proposed setup after approval

Follow the full [production runbook](deployment.md) for backup, migration review,
security, and release verification. The following choices specialize that runbook;
they do not authorize creating or deploying anything now.

### 1. Database

Create a Neon **Free** project in a region near the selected Render region. Choose
PostgreSQL 17 to match local/CI testing, if offered. Obtain its verified-TLS pooled
runtime URL and direct/unpooled release URL. Keep production and local test databases
separate; never point the integration suite at Neon. Preserve all six migrations.

Apply `db:deploy` and the idempotent catalog seed in a separate approved release
job or trusted operator environment; Render Free has no interactive shell/one-off
job. Build/deploy commands do not perform this work automatically. Use direct
migration credentials for DDL, and remember that the seed uses `DATABASE_URL`.
Do not use a broad runtime role solely for seeding convenience.

### 2. API

Review `deploy/render.example.yaml` from the repository root. If approved, configure
one Free Node service using its build/start commands; select no paid worker or
Render database. Set:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
APP_ORIGIN=https://your-approved-frontend.vercel.app
DATABASE_URL=<Neon pooled runtime URL, server secret>
CSRF_SECRET=<stable random secret of at least 64 characters>
TRUSTED_PROXIES=<verified proxy IPs/CIDRs, or empty until verified>
EMAIL_MODE=disabled
CRYPTO_DATA_MODE=coinpaprika
STOCK_DATA_MODE=demo
MARKET_WORKER_ENABLED=true
MARKET_ALWAYS_ON=false
```

Let Render supply `PORT`. The template uses `/api/v1/health/live` as the routine
platform health probe so it does not wake Neon merely to test process liveness.
Check `/api/v1/health/ready` during approved release verification or genuine
troubleshooting, not as an external frequent keep-alive. A cold start can exceed
the browser's ten-second request timeout; existing error/retry states remain and
can recover after the service wakes. Do not hide that delay as fresh data.

Identify the actual Render/Vercel forwarded-IP chain before setting proxy trust.
The API still rejects blanket trust. With trust empty, clients behind the same
proxy can share an IP rate limit; verify independent-client behavior before public
use. Do not guess network ranges, trust all headers, or relax CSRF/origin checks.

### 3. Frontend and same-origin authentication

Review the Vercel example with project root set to the **repository root**. Replace
only its placeholder API origin with the approved HTTPS Render origin. After
approval, it can become the project's active `vercel.json`. Keep Git automatic
deployments disabled until separately approved. The frontend build intentionally
builds contracts and web only; it needs no database URL or CSRF secret.

The API rewrite must precede SPA fallback. Browsers continue to call relative
`/api/v1` paths on the Vercel origin; no cross-site-cookie or permissive CORS change
is needed. Preserve API paths, Origin, request bodies, and Set-Cookie responses.
The template disables rewrite caching explicitly, keeping sessions and private
responses out of the CDN. [Vercel rewrite/caching behavior](https://vercel.com/docs/routing/rewrites).

Use one exact approved production `APP_ORIGIN`; arbitrary preview domains should
not share production sessions or data. Verify login, CSRF rotation, secure
`__Host-` cookies, sign-out, lists, and alerts **through the final proxy**. These
network behaviors cannot be proven by local template tests. Do not switch cookies
to SameSite=None or remove their security attributes to work around a bad proxy.

### 4. Optional background schedule

After explicit approval of background data access, the repository owner can:

- Confirm that this is already a public repository and that standard runner and
  data-provider use fits their account policies. Do not change repository visibility
  solely to make the workflow run.
- Add `FREE_ALERTS_DATABASE_URL` as a GitHub Actions secret. Use a runtime database
  role that supports the existing ingestion/alert transactions, not migration DDL.
- Set repository variable `ENABLE_FREE_ALERTS` to literal `true`. Leave it unset
  to keep all scheduled and manual batch jobs disabled.
- Keep the schedule on the default branch. Inspect initial logs and Neon/provider
  budgets. Disable the variable if consumption approaches a free allowance.

This preparation adds no secret or repository variable and invokes no workflow.
The worker contacts Neon and CoinPaprika directly; it neither calls the Render URL
nor fabricates traffic to prevent its idle sleep. It sends no email. Keep API and
batch data modes/quotas aligned as supplied; do not create an unauthenticated cron
endpoint or put secrets in URLs/browser bundles.

## Alternatives and acceptance boundary

A Render static frontend is also free, but still needs correct same-origin API
routing; Vercel's documented rewrite makes the selected split straightforward.
Putting this long-running Express/worker stack into Vercel Functions would require
a lifecycle redesign. Replacing Prisma/PostgreSQL or custom authentication to chase
a different free service would add migration risk without fixing source-data or
scheduler availability. Neither is necessary for this personal-demo profile.

If the requirement is uninterrupted monitoring with prompt alerts and dependable
account recovery, this plan does not meet it. That needs a separately approved
service/availability design; no hidden paid upgrade or feature removal is proposed.
Free quotas and policies can change, so recheck linked sources before provisioning.
