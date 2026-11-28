import {
  PORTFOLIO_LIMITS,
  portfolioInputSchema,
  portfolioTransactionInputSchema,
} from '@marketpulse/contracts';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http-error.js';

const include = {
  transactions: {
    include: { asset: true },
    orderBy: [{ executedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  },
} satisfies Prisma.PortfolioInclude;
export type StoredPortfolio = Prisma.PortfolioGetPayload<{
  include: typeof include;
}>;
const missing = () => new HttpError(404, 'Portfolio not found');

type LedgerTransaction = {
  assetId: string;
  side: 'BUY' | 'SELL';
  quantity: Prisma.Decimal;
  executedAt: Date;
  createdAt: Date;
  id: string;
};

function transactionOrder<
  T extends { executedAt: Date; createdAt: Date; id: string },
>(transactions: T[]) {
  return [...transactions].sort(
    (a, b) =>
      a.executedAt.getTime() - b.executedAt.getTime() ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
}

export function assertPortfolioLedgerValid(transactions: LedgerTransaction[]) {
  const quantities = new Map<string, Prisma.Decimal>();
  for (const item of transactionOrder(transactions)) {
    const available = quantities.get(item.assetId) ?? new Prisma.Decimal(0);
    if (item.side === 'SELL' && item.quantity.gt(available))
      throw new HttpError(
        409,
        'This sale would exceed the shares or units held at that time.',
      );
    quantities.set(
      item.assetId,
      item.side === 'BUY'
        ? available.plus(item.quantity)
        : available.minus(item.quantity),
    );
  }
}

export function createPortfolioRepository(db: PrismaClient) {
  async function owned(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string,
    lock = false,
  ) {
    if (lock)
      await tx.$queryRaw`SELECT id FROM portfolios WHERE id = ${id}::uuid AND "userId" = ${userId}::uuid AND mode = 'REAL'::"DataMode" FOR UPDATE`;
    const portfolio = await tx.portfolio.findFirst({
      where: { id, userId, mode: 'REAL' },
      include,
    });
    if (!portfolio) throw missing();
    return portfolio;
  }
  function write<T>(
    userId: string,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return db.$transaction(
      async (tx) => {
        const users = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
        if (!users.length) throw new HttpError(401, 'Sign in to continue');
        return operation(tx);
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  return {
    list(userId: string) {
      return db.portfolio.findMany({
        where: { userId, mode: 'REAL' },
        include,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    },
    async create(userId: string, input: unknown) {
      const { name } = portfolioInputSchema.parse(input);
      return write(userId, async (tx) => {
        if (
          (await tx.portfolio.count({ where: { userId, mode: 'REAL' } })) >=
          PORTFOLIO_LIMITS.portfolios
        )
          throw new HttpError(409, 'You can create up to 10 portfolios.');
        return tx.portfolio.create({
          data: { userId, name, mode: 'REAL', baseCurrency: 'USD' },
          include,
        });
      });
    },
    async addTransaction(userId: string, id: string, input: unknown) {
      const value = portfolioTransactionInputSchema.parse(input);
      const executedAt = new Date(value.executedAt);
      if (
        !Number.isFinite(executedAt.getTime()) ||
        executedAt.getTime() > Date.now()
      )
        throw new HttpError(400, 'Trade time cannot be in the future.');
      return write(userId, async (tx) => {
        const portfolio = await owned(tx, userId, id, true);
        if (portfolio.transactions.length >= PORTFOLIO_LIMITS.transactions)
          throw new HttpError(
            409,
            'This portfolio has reached its transaction limit.',
          );
        const asset = await tx.asset.findFirst({
          where: { id: value.assetId, isActive: true },
        });
        if (!asset)
          throw new HttpError(404, 'Asset is not in the active catalog.');
        const createdAt = new Date(
          Math.max(
            Date.now(),
            ...portfolio.transactions.map((item) => item.createdAt.getTime()),
          ) + 1,
        );
        const candidate = {
          assetId: value.assetId,
          side: value.side,
          quantity: new Prisma.Decimal(value.quantity),
          executedAt,
          createdAt,
          id: 'pending',
        } as const;
        assertPortfolioLedgerValid([...portfolio.transactions, candidate]);
        return tx.transaction.create({
          data: {
            portfolioId: portfolio.id,
            assetId: asset.id,
            mode: 'REAL',
            side: value.side,
            quantity: value.quantity,
            unitPrice: value.unitPrice,
            fee: value.fee,
            executedAt,
            createdAt,
          },
          include: { asset: true },
        });
      });
    },
    async deleteTransaction(
      userId: string,
      portfolioId: string,
      transactionId: string,
    ) {
      return write(userId, async (tx) => {
        const portfolio = await owned(tx, userId, portfolioId, true);
        const existing = portfolio.transactions.find(
          (item) => item.id === transactionId,
        );
        if (!existing) throw new HttpError(404, 'Transaction not found');
        assertPortfolioLedgerValid(
          portfolio.transactions
            .filter((item) => item.id !== transactionId)
            .map((item) => ({
              ...item,
              quantity: new Prisma.Decimal(item.quantity),
            })),
        );
        await tx.transaction.delete({ where: { id: transactionId } });
      });
    },
    async delete(userId: string, id: string) {
      return write(userId, async (tx) => {
        const result = await tx.portfolio.deleteMany({
          where: { id, userId, mode: 'REAL' },
        });
        if (!result.count) throw missing();
      });
    },
  };
}
