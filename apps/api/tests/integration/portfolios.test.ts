import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createDatabaseClient } from '../../src/db/client.js';
import { createPortfolioService } from '../../src/modules/portfolios/service.js';
import type { MarketService } from '../../src/modules/markets/service.js';
import { HttpError } from '../../src/lib/http-error.js';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Explicit local TEST_DATABASE_URL is required');
const target = new URL(url);
if (
  !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
  target.pathname !== '/marketpulse_test'
)
  throw new Error('Portfolio tests require isolated local marketpulse_test');
const db = createDatabaseClient(url);
const secondDb = createDatabaseClient(url);
const noPrices = {
  async quotes() {
    return { quotes: [] };
  },
} as unknown as MarketService;
const service = createPortfolioService(db, noPrices);
const secondService = createPortfolioService(secondDb, noPrices);
const users: string[] = [];
const assets: string[] = [];
const status = (code: number) => (error: unknown) =>
  error instanceof HttpError && error.status === code;

before(async () => {
  await Promise.all([db.$connect(), secondDb.$connect()]);
});
after(async () => {
  try {
    if (users.length)
      await db.user.deleteMany({ where: { id: { in: users } } });
    if (assets.length)
      await db.asset.deleteMany({ where: { id: { in: assets } } });
  } finally {
    await Promise.all([db.$disconnect(), secondDb.$disconnect()]);
  }
});
async function user() {
  const row = await db.user.create({
    data: {
      email: `${randomUUID()}@example.test`,
      displayName: 'Portfolio integration test',
      passwordHash: 'test-only-unused-hash',
    },
  });
  users.push(row.id);
  return row.id;
}
async function asset() {
  const row = await db.asset.create({
    data: {
      key: `portfolio-test:${randomUUID()}`,
      type: 'STOCK',
      symbol: 'PTEST',
      name: 'Portfolio test stock',
      exchange: 'NASDAQ',
      isDemoOnly: true,
    },
  });
  assets.push(row.id);
  return row;
}
async function cryptoAsset() {
  const row = await db.asset.create({
    data: {
      key: `portfolio-test:${randomUUID()}`,
      type: 'CRYPTO',
      symbol: 'PCRYPT',
      name: 'Portfolio test crypto',
      isDemoOnly: false,
    },
  });
  assets.push(row.id);
  return row;
}
const input = (
  assetId: string,
  side: 'BUY' | 'SELL',
  quantity: string,
  executedAt: string,
) => ({
  assetId,
  side,
  quantity,
  unitPrice: '100',
  fee: '1',
  executedAt,
});

test('portfolio ledger is private, rejects overselling, preserves data when prices are unavailable', async () => {
  const owner = await user();
  const stranger = await user();
  const row = await asset();
  const portfolio = await service.create(owner, {
    name: 'Personal ledger',
    mode: 'DEMO',
  });
  await service.addTransaction(
    owner,
    portfolio.id,
    input(row.id, 'BUY', '10', '2026-01-01T10:00:00.000Z'),
  );
  await service.addTransaction(
    owner,
    portfolio.id,
    input(row.id, 'SELL', '4', '2026-01-02T10:00:00.000Z'),
  );
  await assert.rejects(
    () =>
      service.addTransaction(
        owner,
        portfolio.id,
        input(row.id, 'SELL', '7', '2026-01-03T10:00:00.000Z'),
      ),
    status(409),
  );
  await assert.rejects(
    () =>
      service.addTransaction(
        stranger,
        portfolio.id,
        input(row.id, 'BUY', '1', '2026-01-03T10:00:00.000Z'),
      ),
    status(404),
  );
  await assert.rejects(
    () => service.delete(stranger, portfolio.id),
    status(404),
  );
  await assert.rejects(
    () => service.deleteTransaction(stranger, portfolio.id, randomUUID()),
    status(404),
  );
  const response = await service.list(owner);
  assert.equal(response.portfolios.length, 1);
  assert.equal(response.portfolios[0]!.transactions.length, 2);
  assert.equal(
    response.portfolios[0]!.positions[0]!.quantity,
    '6.000000000000000000',
  );
  assert.equal(
    response.portfolios[0]!.positions[0]!.investedAmount,
    '600.600000000000000000',
  );
  assert.equal(response.portfolios[0]!.positions[0]!.marketValue, null);
  assert.equal(response.portfolios[0]!.positions[0]!.totalReturn, null);
  assert.deepEqual(await service.list(stranger), { portfolios: [] });
});

test('concurrent sales serialize so the ledger cannot oversell', async () => {
  const owner = await user();
  const row = await asset();
  const portfolio = await service.create(owner, {
    name: 'Concurrent ledger',
    mode: 'DEMO',
  });
  await service.addTransaction(
    owner,
    portfolio.id,
    input(row.id, 'BUY', '10', '2026-02-01T10:00:00.000Z'),
  );
  const sales = await Promise.allSettled([
    service.addTransaction(
      owner,
      portfolio.id,
      input(row.id, 'SELL', '7', '2026-02-02T10:00:00.000Z'),
    ),
    secondService.addTransaction(
      owner,
      portfolio.id,
      input(row.id, 'SELL', '7', '2026-02-03T10:00:00.000Z'),
    ),
  ]);
  assert.equal(
    sales.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  const rejected = sales.find((result) => result.status === 'rejected');
  assert.ok(rejected && status(409)(rejected.reason));
  const current = await service.list(owner);
  assert.equal(
    current.portfolios[0]!.positions[0]!.quantity,
    '3.000000000000000000',
  );
  assert.equal(current.portfolios[0]!.transactions.length, 2);
});

test('deleting a buy is blocked when it would make a later sale invalid', async () => {
  const owner = await user();
  const row = await asset();
  const portfolio = await service.create(owner, {
    name: 'Correctable ledger',
    mode: 'DEMO',
  });
  await service.addTransaction(
    owner,
    portfolio.id,
    input(row.id, 'BUY', '5', '2026-03-01T10:00:00.000Z'),
  );
  await service.addTransaction(
    owner,
    portfolio.id,
    input(row.id, 'BUY', '5', '2026-03-02T10:00:00.000Z'),
  );
  await service.addTransaction(
    owner,
    portfolio.id,
    input(row.id, 'SELL', '8', '2026-03-03T10:00:00.000Z'),
  );
  const current = await service.list(owner);
  const firstBuy = current.portfolios[0]!.transactions.find((transaction) =>
    transaction.executedAt.startsWith('2026-03-01'),
  )!;
  await assert.rejects(
    () => service.deleteTransaction(owner, portfolio.id, firstBuy.id),
    status(409),
  );
  assert.equal(
    (await service.list(owner)).portfolios[0]!.transactions.length,
    3,
  );
});

test('transaction mode follows portfolio mode and rejects incompatible catalog assets before database triggers', async () => {
  const owner = await user();
  const stock = await asset();
  const crypto = await cryptoAsset();
  const realPortfolio = await service.create(owner, {
    name: 'Real market ledger',
    mode: 'REAL',
  });
  await assert.rejects(
    () =>
      service.addTransaction(
        owner,
        realPortfolio.id,
        input(stock.id, 'BUY', '1', '2026-04-01T10:00:00.000Z'),
      ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 409 &&
      error.message.includes('demo-mode portfolio'),
  );
  await service.addTransaction(
    owner,
    realPortfolio.id,
    input(crypto.id, 'BUY', '1', '2026-04-01T10:00:00.000Z'),
  );
  const realTrade = await db.transaction.findFirstOrThrow({
    where: { portfolioId: realPortfolio.id },
  });
  assert.equal(realTrade.mode, 'REAL');

  const demoPortfolio = await service.create(owner, {
    name: 'Demo catalog ledger',
    mode: 'DEMO',
  });
  await service.addTransaction(
    owner,
    demoPortfolio.id,
    input(stock.id, 'BUY', '2', '2026-04-02T10:00:00.000Z'),
  );
  await assert.rejects(
    () =>
      service.addTransaction(
        owner,
        demoPortfolio.id,
        input(crypto.id, 'BUY', '1', '2026-04-03T10:00:00.000Z'),
      ),
    (error: unknown) => error instanceof HttpError && error.status === 409,
  );
  const demoTrade = await db.transaction.findFirstOrThrow({
    where: { portfolioId: demoPortfolio.id },
  });
  assert.equal(demoTrade.mode, 'DEMO');
  const listedDemo = (await service.list(owner)).portfolios.find(
    (portfolio) => portfolio.id === demoPortfolio.id,
  )!;
  assert.equal(listedDemo.mode, 'DEMO');
  assert.equal(listedDemo.positions[0]!.marketValue, null);
  assert.equal(listedDemo.positions[0]!.totalReturn, null);
});
