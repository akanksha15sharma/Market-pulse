import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Vercel template keeps API requests before SPA fallback and builds only the frontend', async () => {
  const config = JSON.parse(await read('deploy/vercel.example.json'));
  assert.equal(config.git.deploymentEnabled, false);
  assert.equal(config.outputDirectory, 'apps/web/dist');
  assert.equal(config.rewrites[0].source, '/api/:path*');
  assert.equal(
    config.rewrites[0].destination,
    'https://api.example.invalid/api/:path*',
  );
  assert.equal(config.rewrites[1].destination, '/index.html');
  assert.match(config.buildCommand, /contracts.*web/);
  assert.doesNotMatch(config.buildCommand, /@marketpulse\/api|db:|worker/);
  const apiHeaders = config.headers.find(
    (rule) => rule.source === '/api/:path*',
  ).headers;
  assert.ok(
    apiHeaders.some(
      (header) =>
        header.key === 'x-vercel-enable-rewrite-caching' &&
        header.value === '0',
    ),
  );
  assert.ok(
    apiHeaders.some(
      (header) =>
        header.key === 'Vercel-CDN-Cache-Control' &&
        header.value === 'no-store',
    ),
  );
  assert.equal(config.crons, undefined);
  assert.equal(config.env, undefined);
});

test('active Vercel config proxies every API path to Render before the SPA fallback', async () => {
  const config = JSON.parse(await read('vercel.json'));
  const template = JSON.parse(await read('deploy/vercel.example.json'));
  template.rewrites[0].destination =
    'https://market-pulse-r246.onrender.com/api/:path*';
  // Preserve the reviewed build, cache, security-header, and deploy settings.
  assert.deepEqual(config, template);
  const [api, spa] = config.rewrites;
  for (const path of [
    '/api/v1/assets?limit=15',
    '/api/v1/quotes',
    '/api/v1/market-status',
    '/api/v1/auth/csrf',
    '/api/v1/auth/login',
    '/api/v1/watchlists',
    '/api/v1/alerts',
  ]) {
    const match = /^\/api\/(.*)$/.exec(path);
    assert.ok(match);
    const destination = api.destination.replace(':path*', match[1]);
    assert.equal(
      new URL(destination).origin,
      'https://market-pulse-r246.onrender.com',
    );
    assert.equal(
      new URL(destination).pathname + new URL(destination).search,
      path,
    );
  }
  for (const path of ['/markets', '/assets/asset-id', '/login'])
    assert.equal(/^\/api\//.test(path), false);
  assert.equal(spa.source, '/(.*)');
  assert.equal(spa.destination, '/index.html');
  assert.ok(
    config.headers.every((rule) =>
      rule.headers.every(
        (header) => !/^access-control-allow-/i.test(header.key),
      ),
    ),
  );
});

test('Render template opts into free compute, disables automatic deploys, and never migrates on startup', async () => {
  const template = await read('deploy/render.example.yaml');
  assert.match(template, /plan: free/);
  assert.match(template, /autoDeployTrigger: off/);
  assert.match(template, /healthCheckPath: \/api\/v1\/health\/live/);
  assert.match(template, /startCommand: npm start/);
  assert.doesNotMatch(template, /type: worker|^databases:|db:deploy|db:seed/m);
  for (const name of [
    'DATABASE_URL',
    'APP_ORIGIN',
    'CSRF_SECRET',
    'TRUSTED_PROXIES',
  ])
    assert.match(template, new RegExp(`key: ${name}\\s+sync: false`));
});

test('background workflow requires explicit opt-in, public standard runners, and one non-overlapping batch', async () => {
  const workflow = await read('.github/workflows/free-alerts.yml');
  assert.match(workflow, /ENABLE_FREE_ALERTS == 'true'/);
  assert.match(workflow, /repository.private == false/);
  assert.match(workflow, /repository.visibility == 'public'/);
  assert.match(workflow, /repository.default_branch/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.match(workflow, /cron: '17,47 \* \* \* \*'/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /timeout-minutes: 5/);
  assert.match(workflow, /run: npm run worker:once/);
  assert.match(workflow, /secrets.FREE_ALERTS_DATABASE_URL/);
  assert.doesNotMatch(
    workflow,
    /worker:start|curl|db:deploy|db:seed|pull_request|npm run dev|actions\/upload-artifact/,
  );
});
