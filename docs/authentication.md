# Phase 3 — authentication

Status: locally verified. The user reports all 12 Phase 3 tests, migrations, lint,
typecheck and build passing. See PHASE3-VERIFICATION.md for evidence attribution.

## Implementation and endpoints

The auth module separates HTTP routes, business logic, persistence and security
helpers. PostgreSQL stores user records, hashed opaque sessions and hashed one-time
tokens. Routes return public user fields only. React uses same-origin requests with
HttpOnly cookies; no bearer/session tokens are exposed to localStorage or JavaScript.

| Method/path under /api/v1      | Behavior                                                                 |
| ------------------------------ | ------------------------------------------------------------------------ |
| GET /auth/csrf                 | Issue a signed CSRF cookie and matching response token                   |
| POST /auth/register            | Validate/normalize inputs, hash password, create account and new session |
| POST /auth/login               | Verify credentials and rotate the supplied session                       |
| POST /auth/logout              | Revoke supplied session and clear cookies; idempotent                    |
| GET /auth/me                   | Return authenticated public user or 401                                  |
| GET /auth/sessions             | List only the user's active sessions, never token hashes                 |
| DELETE /auth/sessions/:id      | Owner-scoped revocation; clear cookies if current session                |
| POST /auth/resend-verification | Authenticated explicit verification-email request                        |
| POST /auth/verify-email        | Consume verification token once                                          |
| POST /auth/forgot-password     | Generic existing/unknown-account response when mail enabled              |
| POST /auth/reset-password      | Consume reset token, replace password, revoke all user sessions          |
| GET /private/profile           | Minimal authenticated API example                                        |

Registration signs in an unverified account; verification is explicitly requested
from Account. This avoids reporting a mail failure after successful registration.
Verified status is visible; later features that send market emails must require a
verified address. Email verification is not required merely to inspect one's account.

UI: /register, /login, /account, /forgot-password, /reset-password, /verify-email.
/account loads authenticated identity and sessions, redirecting 401 to /login while
surfacing infrastructure failures. Forms have labels, password-manager autocomplete,
pending/error states and validation. Session revocation and logout are available.
Verification/reset links place tokens in fragments, not query strings. Pages remove
the fragment from the current history entry and require an explicit submission.

## Security decisions

- Node 22 built-in scrypt: N=131072, r=8, p=1, random 128-bit salt, 64-byte output;
  constant-time digest comparisons. Passwords are never trimmed or truncated.
  Registration/reset accepts 12–128 characters. At most two hashing operations run
  per process; excess work fails temporarily with 503 to bound memory usage.
- This supersedes the original Argon2id recommendation for the current runtime.
  Argon2 could not be installed through the restricted registry; scrypt is the
  documented OWASP fallback and adds no native dependency. Encoded hashes include
  algorithm/cost parameters; a future algorithm change requires explicit migration
  or login-time rehashing, not silently interpreting existing hashes differently.
- Session tokens contain 256 random bits; only SHA-256 hashes are stored. Seven-day
  absolute expiry by default; maximum ten active sessions/user. Login serializes
  session issuance against password reset and rechecks the verified hash.
- Cookies: HttpOnly, SameSite=Strict, Path=/, no Domain. Production adds Secure and
  __Host- prefixes. Logout/revocation is server-side, not just browser deletion.
- Every mutation requires exact configured Origin and a signed double-submit CSRF
  token bound to the current session or an anonymous context. Tokens expire after
  30 minutes and cannot survive session rotation. No wildcard credentialed CORS.
- Persistent atomic PostgreSQL limits: 30 mutations/IP/path per 15 minutes; login
  8/email/15 minutes; registration 5/email/hour; recovery and resend 3/identity/hour.
  Keys are SHA-256 digests, not raw email/IP. New migration adds auth_rate_limits.
  Windows survive restarts; 429 includes a conservative Retry-After header.
- Unknown users still incur password hashing. Login errors are generic; recovery
  messages do not reveal existence. Local synchronous mail delivery can differ in
  timing; public email delivery remains disabled until a production mail integration
  and its delivery/reliability controls are implemented in Phase 9.
- Verification lasts 24 hours; reset lasts 30 minutes. Tokens are hashed, single-use,
  and consumed atomically. Reset invalidates all outstanding reset tokens and user
  sessions. Concurrent use of one reset token must succeed only once.
- JSON body limit 16 KB, strict shared Zod inputs, safe errors/request IDs, no body,
  cookie, credential or raw database-error logging. Auth/private responses use no-store.
  Security headers prevent sniffing/framing/referrer leakage for API responses.

Sources: [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
[OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).

## Configuration and local verification

Merge new values from apps/api/.env.example into an existing local .env; do not
overwrite credentials. APP_ORIGIN must exactly match the address opened in the
browser (127.0.0.1 and localhost are different). Default is http://127.0.0.1:5173.
Production requires HTTPS APP_ORIGIN and a stable random CSRF_SECRET of at least
64 characters. Development uses a process-local secret if omitted; sessions persist
but old CSRF tokens must be refreshed after restart. Trust proxy remains disabled:
configure only the actual deployment proxy in Phase 12 before serving public traffic.

EMAIL_MODE defaults to disabled. To exercise verification/recovery locally, set
EMAIL_MODE=mailpit and MAILPIT_URL=http://127.0.0.1:8025. Compose includes a localhost-
bound Mailpit service; open its UI on port 8025 to inspect captured mail. It does not
send public email. Production rejects Mailpit mode. Disabled email returns 503 for
requests that need it, without returning plaintext tokens. Tests inject a memory sink.
[Mailpit HTTP send API](https://mailpit.axllent.org/docs/usage/sending-messages/).

From the repository root, on a host with working Docker/PostgreSQL:

```sh
npm run db:up
npm run db:generate
npm run db:validate
npm run db:deploy
DATABASE_URL=postgresql://marketpulse:marketpulse_dev@127.0.0.1:5432/marketpulse_test DIRECT_DATABASE_URL=postgresql://marketpulse:marketpulse_dev@127.0.0.1:5432/marketpulse_test npm run db:deploy
npm test
TEST_DATABASE_URL=postgresql://marketpulse:marketpulse_dev@127.0.0.1:5432/marketpulse_test npm run test:db
TEST_DATABASE_URL=postgresql://marketpulse:marketpulse_dev@127.0.0.1:5432/marketpulse_test npm run test:auth:db
npm run lint
npm run typecheck
npm run build
npm run format:check
npm run dev
```

Existing Phase 2 migrations are unchanged. Apply the new additive migration to both
application and test databases. Tests require a dedicated local marketpulse_test;
no external host or application database is accepted. Auth tests create UUID-named
synthetic users and clean up only their own IDs and limiter keys, without resetting
or truncating the database. No existing account data is seeded or deleted.

Manual browser checks: register; inspect Account; refresh; sign out; verify protected
/account redirects; sign in with correct/incorrect passwords; create a second browser
session and revoke it; request verification and reset links through Mailpit; verify
single-use behavior; confirm password reset invalidates existing sessions.

## Operational limits

Periodic deletion of expired sessions/tokens/rate windows is required before public
use; durable cleanup jobs remain part of later worker/operations work. Mail sending
here is synchronous local capture, not the Phase 9 durable price-alert email queue.
Production account email is intentionally disabled pending that integration. No MFA,
OAuth, password-change settings or market endpoints are added. Full browser event
and end-to-end testing remains a later hardening step; current frontend tests cover
form rendering and protected loader behavior.
