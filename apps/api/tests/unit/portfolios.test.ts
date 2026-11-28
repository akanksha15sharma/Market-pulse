import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Prisma } from '../../src/generated/prisma/client.js';
import type { MarketService } from '../../src/modules/markets/service.js';
import { calculatePortfolio } from '../../src/modules/portfolios/service.js';
import type { StoredPortfolio } from '../../src/modules/portfolios/repository.js';
import { assertPortfolioLedgerValid } from '../../src/modules/portfolios/repository.js';

const asset = {
  id: randomUUID(),
  key: 'test:portfolio-asset',
  type: 'CRYPTO' as const,
  symbol: 'TST',
  name: 'Portfolio test asset',
  exchange: null,
  quoteCurrency: 'USD',
  isDemoOnly: false,
  isActive: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};
const portfolioId = randomUUID();
const userId = randomUUID();
function trade(
  side: 'BUY' | 'SELL',
  quantity: string,
  unitPrice: string,
  fee: string,
  executedAt: string,
  id = randomUUID(),
) {
  return {
    id,
    portfolioId,
    assetId: asset.id,
    mode: 'REAL' as const,
    side,
    quantity: new Prisma.Decimal(quantity),
    unitPrice: new Prisma.Decimal(unitPrice),
    fee: new Prisma.Decimal(fee),
    executedAt: new Date(executedAt),
    createdAt: new Date(executedAt),
    asset,
  };
}
function holding(
  transactions: ReturnType<typeof trade>[],
  mode: 'REAL' | 'DEMO' = 'REAL',
) {
  return {
    id: portfolioId,
    userId,
    name: 'Test portfolio',
    mode,
    baseCurrency: 'USD',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    transactions,
  } as unknown as StoredPortfolio;
}
function quote(
  overrides: Record<string, unknown> = {},
): Awaited<ReturnType<MarketService['quotes']>>['quotes'][number] {
  return {
    assetId: asset.id,
    provider: 'COINPAPRIKA',
    mode: 'REAL',
    currency: 'USD',
    simulated: false,
    status: 'fresh',
    price: '190.000000000000000000',
    changePercent: null,
    sourceAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    reason: null,
    ...overrides,
  } as Awaited<ReturnType<MarketService['quotes']>>['quotes'][number];
}

test('weighted-average holdings include buy fees and realize sale proceeds net of sell fees', () => {
  const portfolio = holding([
    trade('BUY', '10', '100', '10', '2026-01-01T10:00:00Z'),
    trade('BUY', '10', '200', '10', '2026-01-02T10:00:00Z'),
    trade('SELL', '5', '180', '5', '2026-01-03T10:00:00Z'),
  ]);
  const result = calculatePortfolio(portfolio, [quote()]);
  const position = result.positions[0]!;
  assert.equal(position.quantity, '15.000000000000000000');
  assert.equal(position.investedAmount, '2265.000000000000000000');
  assert.equal(position.marketValue, '2850.000000000000000000');
  assert.equal(position.realizedReturn, '140.000000000000000000');
  assert.equal(position.totalReturn, '725.000000000000000000');
  assert.equal(result.investedAmount, '2265.000000000000000000');
  assert.equal(result.totalReturn, '725.000000000000000000');
  assert.equal(result.returnPercent, '24.006623');
  assert.equal(result.valuationAvailable, true);
});

test('missing, stale, simulated, and unsupported quotes never produce valuation or returns', () => {
  const portfolio = holding([
    trade('BUY', '2', '100', '1', '2026-01-01T10:00:00Z'),
  ]);
  const invalidQuotes = [
    [],
    [quote({ status: 'stale' })],
    [quote({ provider: 'DEMO', mode: 'DEMO', simulated: true })],
    [quote({ mode: 'DEMO', simulated: false })],
    [quote({ simulated: true })],
    [quote({ price: null })],
    [quote({ price: '0' })],
    [quote({ price: 'Infinity' })],
    [quote({ sourceAt: new Date(Date.now() + 61_000).toISOString() })],
    [quote({ currency: 'EUR' })],
  ];
  for (const quotes of invalidQuotes) {
    const result = calculatePortfolio(portfolio, quotes);
    assert.equal(result.positions[0]!.investedAmount, '201.000000000000000000');
    assert.equal(result.positions[0]!.marketValue, null);
    assert.equal(result.positions[0]!.realizedReturn, null);
    assert.equal(result.positions[0]!.totalReturn, null);
    assert.equal(result.marketValue, null);
    assert.equal(result.totalReturn, null);
    assert.equal(result.valuationAvailable, false);
  }
});

test('a crypto quote cannot value a stock or a demo-only catalog asset', () => {
  const stockTrade = {
    ...trade('BUY', '2', '100', '0', '2026-01-01T10:00:00Z'),
    asset: { ...asset, type: 'STOCK' as const, isDemoOnly: true },
  } as unknown as ReturnType<typeof trade>;
  const portfolio = holding([stockTrade]);
  const result = calculatePortfolio(portfolio, [quote()]);
  assert.equal(result.positions[0]!.marketValue, null);
  assert.equal(result.positions[0]!.totalReturn, null);
  assert.equal(result.valuationAvailable, false);
});

test('demo-mode ledgers never use even a fresh genuine quote for valuation', () => {
  const portfolio = holding(
    [trade('BUY', '2', '100', '0', '2026-01-01T10:00:00Z')],
    'DEMO',
  );
  const result = calculatePortfolio(portfolio, [quote()]);
  assert.equal(result.mode, 'DEMO');
  assert.equal(result.positions[0]!.investedAmount, '200.000000000000000000');
  assert.equal(result.positions[0]!.marketValue, null);
  assert.equal(result.positions[0]!.totalReturn, null);
  assert.equal(result.valuationAvailable, false);
});

test('portfolio total valuation stays unavailable when any open holding lacks a fresh real quote', () => {
  const secondAsset = { ...asset, id: randomUUID(), symbol: 'OTH' };
  const transactions = [
    trade('BUY', '2', '100', '0', '2026-01-01T10:00:00Z'),
    {
      ...trade('BUY', '3', '50', '0', '2026-01-01T10:00:00Z'),
      id: randomUUID(),
      assetId: secondAsset.id,
      asset: secondAsset,
    },
  ];
  const result = calculatePortfolio(holding(transactions), [quote()]);
  assert.equal(
    result.positions.find((position) => position.asset.id === asset.id)
      ?.marketValue,
    '380.000000000000000000',
  );
  assert.equal(
    result.positions.find((position) => position.asset.id === secondAsset.id)
      ?.marketValue,
    null,
  );
  assert.equal(result.marketValue, null);
  assert.equal(result.totalReturn, null);
  assert.equal(result.valuationAvailable, false);
});

test('ledger validation accepts sales within holdings and rejects oversells in execution-time order', () => {
  const entry = (
    side: 'BUY' | 'SELL',
    quantity: string,
    executedAt: string,
    id: string,
  ) => ({
    assetId: asset.id,
    side,
    quantity: new Prisma.Decimal(quantity),
    executedAt: new Date(executedAt),
    createdAt: new Date(executedAt),
    id,
  });
  const buy = entry('BUY', '10', '2026-01-01T10:00:00Z', 'a');
  const sale = entry('SELL', '7', '2026-01-02T10:00:00Z', 'b');
  assert.doesNotThrow(() => assertPortfolioLedgerValid([buy, sale]));
  assert.throws(
    () =>
      assertPortfolioLedgerValid([
        buy,
        entry('SELL', '7', '2026-01-02T10:00:00Z', 'b'),
        entry('SELL', '4', '2026-01-03T10:00:00Z', 'c'),
      ]),
    { status: 409 },
  );
  assert.throws(
    () =>
      assertPortfolioLedgerValid([
        entry('SELL', '6', '2026-01-02T10:00:00Z', 'c'),
        entry('BUY', '5', '2026-01-01T10:00:00Z', 'a'),
      ]),
    { status: 409 },
  );
});
