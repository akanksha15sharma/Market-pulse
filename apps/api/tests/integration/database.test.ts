import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createDatabaseClient } from '../../src/db/client.js';
import type { Prisma } from '../../src/generated/prisma/client.js';
import { seedCatalog } from '../../prisma/seed-catalog.js';

// Never fall back to the application's database or an external connected source.
const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL must explicitly name a local marketpulse_test database',
  );
const target = new URL(url);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  target.pathname !== '/marketpulse_test'
) {
  throw new Error(
    'Database tests require local host and database marketpulse_test',
  );
}
const db = createDatabaseClient(url);
const rollback = new Error('test transaction rollback');
before(async () => {
  await db.$connect();
});
after(async () => {
  await db.$disconnect();
});

async function isolated(run: (tx: Prisma.TransactionClient) => Promise<void>) {
  try {
    await db.$transaction(
      async (tx) => {
        await run(tx);
        throw rollback;
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

async function expectConstraint(
  tx: Prisma.TransactionClient,
  operation: () => Promise<unknown>,
) {
  // PostgreSQL aborts a transaction on constraint errors; recover only the savepoint.
  await tx.$executeRawUnsafe('SAVEPOINT constraint_check');
  try {
    await assert.rejects(operation);
  } finally {
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT constraint_check');
  }
}

async function user(tx: Prisma.TransactionClient) {
  return tx.user.create({
    data: {
      email: `${randomUUID()}@example.test`,
      passwordHash: 'test-placeholder-no-auth',
      displayName: 'Database test',
    },
  });
}

test('catalog seed is idempotent and maps stocks only to the demo provider', async () => {
  await isolated(async (tx) => {
    await seedCatalog(tx);
    const first = await tx.asset.findMany({ orderBy: { key: 'asc' } });
    await seedCatalog(tx);
    const second = await tx.asset.findMany({ orderBy: { key: 'asc' } });
    assert.deepEqual(second, first);
    assert.equal(second.filter((a) => a.type === 'CRYPTO').length, 10);
    assert.equal(
      second.filter((a) => a.type === 'STOCK' && a.isDemoOnly).length,
      5,
    );
    assert.equal(
      await tx.assetProviderMapping.count({ where: { provider: 'COINGECKO' } }),
      10,
    );
    assert.equal(
      await tx.assetProviderMapping.count({
        where: { provider: 'COINPAPRIKA' },
      }),
      10,
    );
    const paprika = await tx.assetProviderMapping.findMany({
      where: { provider: 'COINPAPRIKA' },
      include: { asset: true },
    });
    assert.ok(paprika.every((row) => row.asset.type === 'CRYPTO'));
    assert.equal(
      paprika.find((row) => row.asset.symbol === 'XRP')?.providerAssetId,
      'xrp-xrp',
    );
    assert.equal(
      paprika.find((row) => row.asset.symbol === 'AVAX')?.providerAssetId,
      'avax-avalanche',
    );
    assert.equal(
      await tx.assetProviderMapping.count({ where: { provider: 'DEMO' } }),
      15,
    );
    assert.equal(
      await tx.assetProviderMapping.count({
        where: { provider: 'TWELVE_DATA' },
      }),
      0,
    );
  });
});

test('unique emails, foreign keys, watchlist membership and user cascade', async () => {
  await isolated(async (tx) => {
    await seedCatalog(tx);
    const owner = await user(tx);
    await expectConstraint(tx, () =>
      tx.user.create({
        data: {
          email: owner.email,
          passwordHash: 'unused',
          displayName: 'Duplicate',
        },
      }),
    );
    await expectConstraint(tx, () =>
      tx.user.create({
        data: {
          email: 'UPPER@example.test',
          passwordHash: 'unused',
          displayName: 'Invalid email',
        },
      }),
    );
    const asset = await tx.asset.findUniqueOrThrow({
      where: { key: 'crypto:bitcoin' },
    });
    const list = await tx.watchlist.create({
      data: { userId: owner.id, name: 'Test list' },
    });
    const membership = { watchlistId: list.id, assetId: asset.id };
    await tx.watchlistItem.create({ data: membership });
    await expectConstraint(tx, () =>
      tx.watchlistItem.create({ data: membership }),
    );
    await expectConstraint(tx, () =>
      tx.watchlistItem.create({
        data: { watchlistId: list.id, assetId: randomUUID() },
      }),
    );
    await tx.user.delete({ where: { id: owner.id } });
    assert.equal(
      await tx.watchlistItem.count({ where: { watchlistId: list.id } }),
      0,
    );
    assert.equal(await tx.watchlist.count({ where: { id: list.id } }), 0);
    assert.ok(await tx.asset.findUnique({ where: { id: asset.id } }));
  });
});

test('financial precision, positive values and portfolio mode isolation', async () => {
  await isolated(async (tx) => {
    await seedCatalog(tx);
    const owner = await user(tx);
    const crypto = await tx.asset.findUniqueOrThrow({
      where: { key: 'crypto:bitcoin' },
    });
    const stock = await tx.asset.findUniqueOrThrow({
      where: { key: 'stock:NASDAQ:AAPL' },
    });
    const portfolio = await tx.portfolio.create({
      data: { userId: owner.id, name: 'Real context', mode: 'REAL' },
    });
    const data = {
      portfolioId: portfolio.id,
      assetId: crypto.id,
      mode: 'REAL' as const,
      side: 'BUY' as const,
      quantity: '0.123456789012345678',
      unitPrice: '1234567890.123456789012345678',
      fee: '0',
      executedAt: new Date(),
    };
    const row = await tx.transaction.create({ data });
    assert.equal(row.quantity.toFixed(18), data.quantity);
    assert.equal(row.unitPrice.toFixed(18), data.unitPrice);
    await expectConstraint(tx, () =>
      tx.transaction.create({ data: { ...data, quantity: '0' } }),
    );
    await expectConstraint(tx, () =>
      tx.transaction.create({ data: { ...data, unitPrice: '-1' } }),
    );
    await expectConstraint(tx, () =>
      tx.transaction.create({ data: { ...data, fee: '-1' } }),
    );
    await expectConstraint(tx, () =>
      tx.transaction.create({ data: { ...data, mode: 'DEMO' } }),
    );
    await expectConstraint(tx, () =>
      tx.transaction.create({ data: { ...data, assetId: stock.id } }),
    );
  });
});

test('quote source separation and one alert event per activation', async () => {
  await isolated(async (tx) => {
    await seedCatalog(tx);
    const owner = await user(tx);
    const asset = await tx.asset.findUniqueOrThrow({
      where: { key: 'crypto:bitcoin' },
    });
    const quote = {
      assetId: asset.id,
      currency: 'USD',
      price: '100',
      sourceAt: new Date(),
    };
    await tx.latestQuote.create({
      data: { ...quote, provider: 'COINGECKO', mode: 'REAL' },
    });
    await tx.latestQuote.create({
      data: { ...quote, provider: 'DEMO', mode: 'DEMO' },
    });
    assert.equal(
      await tx.latestQuote.count({ where: { assetId: asset.id } }),
      2,
    );
    await expectConstraint(tx, () =>
      tx.latestQuote.create({
        data: { ...quote, provider: 'DEMO', mode: 'REAL' },
      }),
    );
    const alert = await tx.priceAlert.create({
      data: {
        userId: owner.id,
        assetId: asset.id,
        provider: 'DEMO',
        mode: 'DEMO',
        direction: 'ABOVE',
        threshold: '100',
      },
    });
    const event = {
      alertId: alert.id,
      activation: 1,
      observedPrice: '101',
      sourceAt: new Date(),
    };
    await tx.alertEvent.create({ data: event });
    await expectConstraint(tx, () => tx.alertEvent.create({ data: event }));
    await tx.alertEvent.create({ data: { ...event, activation: 2 } });
  });
});
