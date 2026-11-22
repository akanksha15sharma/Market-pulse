# Phase 3 verification

Status: implementation complete; non-database checks pass. PostgreSQL runtime
acceptance remains blocked in the agent session. Phase 4 has not started.
The repository moved during work to ~/Documents/marketpulse; existing commits and
changes were preserved and work continued there.

| Check                                          | Result                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Prisma client generation and schema validation | Passed                                                                                               |
| Typecheck                                      | Passed for frontend, backend, shared contracts, tests and Prisma tools                               |
| Production build                               | Passed for all three workspaces                                                                      |
| ESLint                                         | Passed                                                                                               |
| Prettier and git diff --check                  | Passed after final formatting                                                                        |
| Backend security tests                         | 6 grouped tests passed, including real production-cost scrypt and port-free Express middleware tests |
| Frontend tests                                 | 2 passed: form rendering/password-manager attributes and protected-loader redirect/error behavior    |
| Lockfile consistency                           | Dependency declarations unchanged and match committed lockfile                                       |
| Compose configuration                          | Validates; Mailpit is localhost-bound                                                                |
| Application migration deployment               | Blocked: Prisma P1001 reaching local PostgreSQL                                                      |
| PostgreSQL auth lifecycle tests                | Authored 4 tests; blocked before scenarios by database connection failure                            |
| Existing Phase 2 DB tests                      | Reattempted; blocked by database connection failure, not a confirmed regression                      |
| Docker daemon                                  | EPERM connecting to /var/run/docker.sock                                                             |
| Browser HTTP/Mailpit manual flows              | Not verified in this session                                                                         |
| Remote CI                                      | Updated to include auth and frontend tests; not executed remotely                                    |

## Coverage and limits

Successful/failed login middleware, protected access, strict validation, generic
errors, CSRF requirements/signature/session binding/expiry, origin checks, cookie
flags and rate-limit responses are covered without opening a socket. Password
hashing uses the actual scrypt settings, not weaker test settings. These middleware
tests inject an auth service; they are not a substitute for the PostgreSQL tests.

Database scenarios cover registration/duplicates/wrong credentials, stored hashes,
session rotation/expiry/logout/ownership, verification and reset token single-use,
concurrent reset, global session revocation and persistent concurrent rate limiting.
Tests accept only an explicit local marketpulse_test database, clean up only their
own fixture records, and use an in-memory mail sink.

## Remaining host verification

See [authentication setup](docs/authentication.md) for commands. Apply the new
20261122000200_auth_rate_limits migration to both existing databases, then run
npm run test:auth:db and npm run test:db with TEST_DATABASE_URL set to the local test
database. Existing Phase 2 migrations must not be changed or reset. Run the manual
browser/Mailpit checklist and confirm production cookie configuration before public
use. Record the host results before claiming Phase 3 fully verified.

No new npm dependencies were introduced. Password-hashing choice is documented in
[ADR 0002](docs/decisions/0002-password-hashing.md); approved Phase 0 documents remain
unchanged. Public mail remains disabled pending later delivery integration.
