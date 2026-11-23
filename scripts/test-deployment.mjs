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
