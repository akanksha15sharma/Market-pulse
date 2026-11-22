# Phase 1 verification — 2026-11-22

Status: scaffold committed; runtime acceptance blocked by environment.

| Check                         | Result                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------- |
| Node / npm                    | Available: Node 22.22.1, npm 9.2.0                                           |
| Workspace manifests           | Valid JSON, all private                                                      |
| JavaScript syntax             | dev runner and ESLint configuration pass node --check                        |
| Formatting                    | Passed via npx --offline prettier --check .                                  |
| Phase 0 documentation         | Unchanged against initial documentation commit                               |
| npm install                   | Blocked: EAI_AGAIN resolving registry.npmjs.org                              |
| Offline installation          | Blocked: incomplete dependency metadata/cache                                |
| Lint                          | Blocked: project ESLint unavailable; system ESLint 6 cannot load flat config |
| Typecheck / build / dev       | Blocked: TypeScript unavailable after failed install                         |
| PostgreSQL / Compose          | Blocked: Docker executable is not installed                                  |
| HTTP and browser smoke checks | Not run; development servers could not start                                 |
| GitHub Actions                | Configured, not remotely executed                                            |

No lockfile was fabricated. CI temporarily uses npm install without caching; after
registry access works, generate/commit package-lock.json and switch CI to npm ci
with npm caching. No Phase 2 work has begun.

## Remaining acceptance steps

1. Run npm install with working registry access; commit the generated lockfile.
2. Run npm run lint, npm run format:check, npm run typecheck and npm run build.
3. Start npm run dev; inspect the landing page and unknown-route page; request
   /api/v1/health/live directly and through the Vite proxy.
4. Start the built API using npm run start -w @marketpulse/api and check liveness.
5. With Docker Compose installed, run npm run db:up, inspect health and execute
   SELECT 1 in PostgreSQL. Stop with npm run db:down to retain its volume.
6. Supply a GitHub repository URL before configuring a remote or pushing. Never
   transmit this repository to a prohibited organization or endpoint.

Phase 1 should not be described as fully verified until these checks pass.

## Follow-up diagnosis

Rechecked on 2026-11-22 without changing dependency declarations or prior commits.

- npm registry configuration is the default https://registry.npmjs.org/.
- getent cannot resolve the registry; curl fails with resolver error 6; a fresh
  npm install with no retries fails EAI_AGAIN.
- Direct Python TCP and UDP socket creation both fail EPERM. Node localhost listen
  also fails EPERM. This environment therefore blocks networking and server binding,
  not merely a particular npm hostname. No resolver or registry workaround applied.
- sudo -n true fails because the no-new-privileges flag prevents root escalation.
- Docker is absent. Local apt indexes list Ubuntu 26.04 candidates docker.io
  29.1.3-0ubuntu4.1 and docker-compose-v2 2.40.3+ds1-0ubuntu1. This is package
  availability evidence, not a successful install or proof of daemon support here.
- Reattempted lint, typecheck, build, dev and db:up: still blocked by missing project
  dependencies/Docker. Formatting passes via the cached Prettier runner.
- Installation, lockfile generation, HTTP smoke tests and database verification remain
  incomplete. Do not label Phase 1 complete or begin Phase 2.

### Host-terminal commands

Run these outside the restricted execution environment, on an Ubuntu host with
network access, sudo and systemd. Do not run npm as root. Ubuntu package sources:
[docker.io](https://packages.ubuntu.com/en/resolute/docker.io),
[docker-compose-v2](https://packages.ubuntu.com/en/resolute/docker-compose-v2).

```sh
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
cd ~/marketpulse
sudo docker compose config --quiet
sudo docker compose up -d --wait
sudo docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT 1;"'
```

If Docker daemon startup fails in a managed container, install/run Docker on the
host rather than assuming sudo alone fixes container capability restrictions.
No Docker-group membership changes are required with the sudo commands above.

```sh
cd ~/marketpulse
npm install
npm run lint
npm run format:check
npm run typecheck
npm run build
npm run dev
```

From a second terminal, while dev is running:

```sh
curl --fail http://127.0.0.1:3001/api/v1/health/live
curl --fail http://127.0.0.1:5173/api/v1/health/live
```

Open http://127.0.0.1:5173 and an unknown path in a browser. Stop development,
start the compiled API with npm run start -w @marketpulse/api and check liveness
again. After install/checks succeed, commit package-lock.json, switch CI to npm ci
with npm caching, and verify a clean npm ci/build before claiming completion.

## API watcher fix — subsequent verification

Dependencies are now installed in the workspace; the earlier installation failures
above are historical. The user reports direct API health succeeds on port 3001.

Reproduced the API dev failure: tsx watch exits before application startup because
its Unix IPC listener at /tmp/tsx-1000/*.pipe fails EPERM in this environment.
Changed only the API dev command to Node 22 native watch with --import tsx and
--watch-preserve-output. Dependency declarations are unchanged.

Verification completed:

- npm run lint, npm run typecheck, npm run build and npm run format:check pass.
- Actual npm API dev command starts the watcher and restarts after touching API
  source and imported compiled contracts. Application binding still fails EPERM in
  this execution environment; a successful HTTP health response was not reproduced here.
- A temporary TypeScript fixture using the same native watcher and importing the
  real contracts package starts, restarts on source and contract changes, recovers
  after an introduced syntax error, and shuts down with exit code 0. Fixture removed.
- No application dependency change, no Phase 2 implementation, no edits to Phase 0 docs.
- The pre-existing untracked package-lock.json is intentionally left untouched and
  outside this focused watcher commit.

Environment-file changes require manual restart. Native watch tracks imported API
and contract modules; root npm run dev continues to compile contracts in watch mode.
