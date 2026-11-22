# ADR 0002 — password hashing on Node 22

Status: accepted for Phase 3; supersedes the initial Argon2id recommendation only.

Use Node crypto.scrypt with N=2^17, r=8, p=1, random 16-byte salts and a 64-byte
output. OWASP recommends scrypt when Argon2id is unavailable. The configured Node 22
runtime does not offer stable built-in Argon2, and registry restrictions prevented
installing a native Argon2 dependency. No dependency or lockfile workaround is used.

Encoded records include algorithm and parameters. Comparisons are constant-time.
Bound concurrency to two hashes (~128 MiB working memory each), return temporary
503 under load, and persist IP/identity rate limits in PostgreSQL. Never reduce work
factors just for tests. Tests use the production hash settings.

Future Argon2id adoption must support old hashes and deliberately rehash on successful
login or migrate credentials through a password-reset workflow. Other Phase 0
architecture decisions remain unchanged.

Source: [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
