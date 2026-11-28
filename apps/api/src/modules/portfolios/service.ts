import {
  portfolioSchema,
  portfoliosResponseSchema,
} from '@marketpulse/contracts';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { marketSettings, nativeMarketsAllowed } from '../../config/markets.js';
import type { MarketService } from '../markets/service.js';
import {
  createPortfolioRepository,
  type StoredPortfolio,
} from './repository.js';

const zero = () => new Prisma.Decimal(0);
type PositionState = {
  asset: StoredPortfolio['transactions'][number]['asset'];
  quantity: Prisma.Decimal;
  costBasis: Prisma.Decimal;
  buySpend: Prisma.Decimal;
  realized: Prisma.Decimal;
};

export function calculatePortfolio(
  portfolio: StoredPortfolio,
  quotes: Awaited<ReturnType<MarketService['quotes']>>['quotes'],
) {
  const byAsset = new Map<string, PositionState>();
  const transactions = [...portfolio.transactions].sort(
    (a, b) =>
      a.executedAt.getTime() - b.executedAt.getTime() ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  for (const transaction of transactions) {
    const state =
      byAsset.get(transaction.assetId) ??
      ({
        asset: transaction.asset,
        quantity: zero(),
        costBasis: zero(),
        buySpend: zero(),
        realized: zero(),
      } satisfies PositionState);
    const quantity = new Prisma.Decimal(transaction.quantity);
    const price = new Prisma.Decimal(transaction.unitPrice);
    const fee = new Prisma.Decimal(transaction.fee);
    if (transaction.side === 'BUY') {
      const spend = quantity.mul(price).plus(fee);
      state.quantity = state.quantity.plus(quantity);
      state.costBasis = state.costBasis.plus(spend);
      state.buySpend = state.buySpend.plus(spend);
    } else {
      const averageCost = state.quantity.isZero()
        ? zero()
        : state.costBasis.div(state.quantity);
      state.costBasis = state.costBasis.minus(averageCost.mul(quantity));
      state.quantity = state.quantity.minus(quantity);
      state.realized = state.realized.plus(
        quantity.mul(price).minus(fee).minus(averageCost.mul(quantity)),
      );
      if (state.quantity.isZero()) state.costBasis = zero();
    }
    byAsset.set(transaction.assetId, state);
  }

  const openPositions = [...byAsset.values()].filter((position) =>
    position.quantity.gt(0),
  );
  const quoteByAsset = new Map(quotes.map((quote) => [quote.assetId, quote]));
  const positions = [...byAsset.values()].map((position) => {
    const quote = quoteByAsset.get(position.asset.id);
    const now = Date.now();
    const sourceAt = quote?.sourceAt ? Date.parse(quote.sourceAt) : Number.NaN;
    const priceIsValid =
      position.quantity.gt(0) &&
      portfolio.mode === 'REAL' &&
      position.asset.type === 'CRYPTO' &&
      !position.asset.isDemoOnly &&
      quote?.provider === 'COINPAPRIKA' &&
      quote.mode === 'REAL' &&
      quote.currency === 'USD' &&
      quote.simulated === false &&
      quote.status === 'fresh' &&
      quote.price !== null &&
      quote.sourceAt !== null &&
      Number.isFinite(sourceAt) &&
      sourceAt <= now + 60_000 &&
      now - sourceAt <= 20 * 60_000 &&
      Number.isFinite(Number(quote.price)) &&
      Number(quote.price) > 0;
    const marketValue = priceIsValid
      ? position.quantity.mul(quote!.price!)
      : null;
    const totalReturn =
      marketValue?.minus(position.costBasis).plus(position.realized) ?? null;
    const returnPercent =
      totalReturn !== null && position.buySpend.gt(0)
        ? totalReturn
            .div(position.buySpend)
            .mul(100)
            .toDecimalPlaces(6)
            .toFixed(6)
        : null;
    return {
      asset: position.asset,
      quantity: position.quantity.toFixed(18),
      investedAmount: position.costBasis.toFixed(18),
      marketValue: marketValue?.toFixed(18) ?? null,
      realizedReturn: priceIsValid ? position.realized.toFixed(18) : null,
      totalReturn: totalReturn?.toFixed(18) ?? null,
      returnPercent,
      price: priceIsValid ? quote!.price : null,
      priceSource: priceIsValid ? quote!.provider : null,
      priceObservedAt: priceIsValid ? quote!.sourceAt : null,
      _buySpend: position.buySpend,
    };
  });
  const allPricesValid =
    openPositions.length > 0 &&
    positions
      .filter((position) => Number(position.quantity) > 0)
      .every((position) => position.marketValue !== null);
  const invested = positions.reduce(
    (total, position) => total.plus(position.investedAmount),
    zero(),
  );
  const buySpend = [...byAsset.values()].reduce(
    (total, position) => total.plus(position.buySpend),
    zero(),
  );
  const realized = [...byAsset.values()].reduce(
    (total, position) => total.plus(position.realized),
    zero(),
  );
  const marketValue = allPricesValid
    ? positions.reduce(
        (total, position) => total.plus(position.marketValue!),
        zero(),
      )
    : null;
  const totalReturn = marketValue?.minus(invested).plus(realized) ?? null;
  const returnPercent =
    totalReturn !== null && buySpend.gt(0)
      ? totalReturn.div(buySpend).mul(100).toDecimalPlaces(6).toFixed(6)
      : null;
  return portfolioSchema.parse({
    id: portfolio.id,
    name: portfolio.name,
    mode: portfolio.mode,
    baseCurrency: 'USD',
    createdAt: portfolio.createdAt.toISOString(),
    investedAmount: invested.toFixed(18),
    marketValue: marketValue?.toFixed(18) ?? null,
    realizedReturn: allPricesValid ? realized.toFixed(18) : null,
    totalReturn: totalReturn?.toFixed(18) ?? null,
    returnPercent,
    valuationAvailable: allPricesValid,
    positions: positions.map(({ _buySpend: _omit, ...position }) => {
      void _omit;
      return position;
    }),
    transactions: portfolio.transactions.map((transaction) => ({
      id: transaction.id,
      asset: transaction.asset,
      side: transaction.side,
      quantity: transaction.quantity.toFixed(18),
      unitPrice: transaction.unitPrice.toFixed(18),
      fee: transaction.fee.toFixed(18),
      executedAt: transaction.executedAt.toISOString(),
      createdAt: transaction.createdAt.toISOString(),
    })),
  });
}

export function createPortfolioService(
  db: PrismaClient,
  market: MarketService,
) {
  const repo = createPortfolioRepository(db);
  return {
    async list(userId: string) {
      const portfolios = await repo.list(userId);
      const ids = [
        ...new Set(
          portfolios.flatMap((portfolio) =>
            portfolio.mode === 'REAL'
              ? portfolio.transactions
                  .filter(
                    (transaction) =>
                      transaction.asset.type === 'CRYPTO' &&
                      !transaction.asset.isDemoOnly,
                  )
                  .map((transaction) => transaction.assetId)
              : [],
          ),
        ),
      ];
      const quotes =
        ids.length && nativeMarketsAllowed(marketSettings)
          ? (await market.quotes(ids)).quotes
          : [];
      return portfoliosResponseSchema.parse({
        portfolios: portfolios.map((portfolio) =>
          calculatePortfolio(portfolio, quotes),
        ),
      });
    },
    async create(userId: string, input: unknown) {
      const portfolio = await repo.create(userId, input);
      return calculatePortfolio(portfolio, []);
    },
    async addTransaction(userId: string, id: string, input: unknown) {
      await repo.addTransaction(userId, id, input);
    },
    deleteTransaction: repo.deleteTransaction,
    delete: repo.delete,
  };
}
export type PortfolioService = ReturnType<typeof createPortfolioService>;
