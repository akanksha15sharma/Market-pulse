import assert from 'node:assert/strict';
import { test } from 'node:test';
import { seedCatalog } from '../../prisma/seed-catalog.js';
import {
  runCatalogSeed,
  seedConnectionOptions,
} from '../../prisma/seed-runner.js';

test('seed warms the connection before one atomic transaction with explicit latency budgets', async () => {
  const calls: string[] = [];
  const db = {
    async $queryRaw(query: TemplateStringsArray) {
      assert.equal(query.join(''), 'SELECT 1');
      calls.push('warm');
    },
    async $transaction(callback: unknown, options: unknown) {
      calls.push('transaction');
      assert.equal(callback, seedCatalog);
      assert.deepEqual(options, { maxWait: 60_000, timeout: 120_000 });
    },
    async $disconnect() {
      calls.push('disconnect');
    },
  };
  await runCatalogSeed(db as unknown as Parameters<typeof runCatalogSeed>[0]);
  assert.deepEqual(calls, ['warm', 'transaction', 'disconnect']);
  assert.deepEqual(seedConnectionOptions, {
    max: 1,
    connectionTimeoutMillis: 30_000,
    query_timeout: 30_000,
  });
});

test('seed propagates connection and transaction failures, disconnects, and never retries writes', async () => {
  for (const stage of ['warm', 'transaction']) {
    const failure = new Error(stage);
    const calls: string[] = [];
    const db = {
      async $queryRaw() {
        calls.push('warm');
        if (stage === 'warm') throw failure;
      },
      async $transaction() {
        calls.push('transaction');
        throw failure;
      },
      async $disconnect() {
        calls.push('disconnect');
      },
    };
    await assert.rejects(
      () =>
        runCatalogSeed(db as unknown as Parameters<typeof runCatalogSeed>[0]),
      (error) => error === failure,
    );
    assert.deepEqual(
      calls,
      stage === 'warm'
        ? ['warm', 'disconnect']
        : ['warm', 'transaction', 'disconnect'],
    );
  }
});
