# Deployment requirements

Checked 2026-11-22. No services provisioned.

| Profile | Components | Availability |
|---|---|---|
| Local | Vite, API/worker, Docker PostgreSQL and Mailpit | While developer runs it; synthetic default |
| Free resume demo | Render Node web service serves React build/API and bounded worker; Neon PostgreSQL | Cold starts and suspension possible; no continuous alerts |
| Continuous alerts | Always-on API, separate worker, appropriately sized PostgreSQL | Paid compute may be needed; upstream failures still possible |

Render free services sleep after 15 minutes without inbound traffic and take about a
minute to wake. Free instance allowance is 750 hours/workspace/month; other usage
limits apply. Render free PostgreSQL expires after 30 days; use Neon for persistence.
Local service files are ephemeral. Do not use artificial keep-alive traffic as an
availability strategy. [Render documentation](https://render.com/docs/free)

Neon publishes 1 GB storage and 100 CU-hours/project/month on free, with idle compute
scaling down. Continuous database polling can prevent idleness and consume capacity;
free compute is not guaranteed to cover an always-on worker. Use small pools and
bounded concurrency. [Neon pricing](https://neon.com/pricing)

For the free demo, run quote scheduling/outbox checks during active visitor sessions,
ending within ten minutes of the last genuine visible-client activity/heartbeat.
No indefinite hidden-tab heartbeats. This lets database compute idle. Pending email
resumes on wake subject to expiry. Show service/price timestamps and explain that
account creation does not provide 24/7 alerts. Recovery evaluates new observations,
not invented crossings during sleep.

## Release requirements

- Pin supported Node LTS at implementation time; HTTPS and WebSocket upgrade support.
- Same-origin frontend/API, TLS database connection, least-privileged credentials.
- Build both apps; migrations run once before release; health and journey smoke tests.
- Graceful shutdown, expiring leases and restart-safe jobs/counters.
- Synthetic CI/previews, no casually shared live credentials.
- Monitor database storage/compute, provider budgets and email quotas.
- No automatic paid upgrades/overages. Explicit degradation when quotas run out.
- Backup/export and tested restore before storing valued user data; no assumed free
  production backup guarantee.

## Planned environment contract

| Group | Names/defaults |
|---|---|
| Runtime | NODE_ENV, PORT, APP_ORIGIN, LOG_LEVEL |
| Database | DATABASE_URL, DIRECT_DATABASE_URL, DB_POOL_MAX |
| Sessions | SESSION_COOKIE_NAME, SESSION_TTL_SECONDS |
| Modes | CRYPTO_DATA_MODE, STOCK_DATA_MODE, DEMO_ENABLED, WORKER_ENABLED |
| Providers | COINGECKO_API_KEY, TWELVE_DATA_API_KEY (disabled/optional) |
| Intervals | CRYPTO_POLL_INTERVAL_SECONDS=600, DEMO_POLL_INTERVAL_SECONDS=60 |
| Crypto budgets | CG_MINUTE_ATTEMPT_LIMIT=10, CG_DAILY_ATTEMPT_LIMIT=260, CG_MONTHLY_ATTEMPT_LIMIT=8000, CG_CHART_DAILY_LIMIT=80 |
| Billing | Account-specific provider reset metadata |
| Email | EMAIL_MODE, RESEND_API_KEY, EMAIL_FROM, SMTP_HOST, SMTP_PORT |
| Email budgets | EMAIL_DAILY_LIMIT=90, EMAIL_MONTHLY_LIMIT=2500, ALERT_EMAIL_DAILY_LIMIT=60, ALERT_EMAIL_MONTHLY_LIMIT=1800 |
| Browser | Same-origin paths by default; never secret VITE_ values |

These are design decisions, not actual environment files. Validate startup settings.
Live mode requires keys/entitlements; do not silently claim live when misconfigured.
Commit placeholders in a later phase, keep actual secrets ignored or in host settings.

## Cost and external gates

Aim for $0 within quotas without custom domain/public email. Mailpit is local-only;
hosted email is disabled without an approved sender. Resend free is 3,000/month and
100/day. Tests can reach the account email; other recipients require a verified
sender domain, potentially adding domain cost.
[Resend pricing](https://resend.com/pricing),
[Domain restrictions](https://resend.com/docs/api-reference/errors).

Before public release: verify crypto display/caching terms and attribution; stocks
remain synthetic absent entitlements; recheck host capacity; test cold-start/queue
recovery. Always-on compute pricing is rechecked when requested, not estimated as
a guaranteed free deployment here.
