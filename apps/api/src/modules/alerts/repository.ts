import { ALERT_ACTIVE_LIMIT } from '@marketpulse/contracts';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http-error.js';
const include = {
  asset: true,
  events: { take: 1, orderBy: [{ triggeredAt: 'desc' }, { id: 'desc' }] },
} satisfies Prisma.PriceAlertInclude;
export type StoredAlert = Prisma.PriceAlertGetPayload<{
  include: typeof include;
}>;
const missing = () => new HttpError(404, 'Alert not found');
export function createAlertRepository(db: PrismaClient) {
  async function owned(
    tx: Prisma.TransactionClient,
    userId: string,
    id: string,
    lock = false,
  ) {
    if (lock)
      await tx.$queryRaw`SELECT id FROM price_alerts WHERE id = ${id}::uuid AND "userId" = ${userId}::uuid FOR UPDATE`;
    const alert = await tx.priceAlert.findFirst({
      where: { id, userId },
      include,
    });
    if (!alert) throw missing();
    return alert;
  }
  async function clock(tx: Prisma.TransactionClient) {
    return (
      await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
    )[0]!.now;
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
  async function capacity(tx: Prisma.TransactionClient, userId: string) {
    if (
      (await tx.priceAlert.count({ where: { userId, status: 'ACTIVE' } })) >=
      ALERT_ACTIVE_LIMIT
    )
      throw new HttpError(
        409,
        'You can have up to 10 active alerts. Pause an alert first.',
      );
  }
  async function duplicate(
    tx: Prisma.TransactionClient,
    userId: string,
    assetId: string,
    direction: 'ABOVE' | 'BELOW',
    threshold: string | Prisma.Decimal,
    id?: string,
  ) {
    if (
      await tx.priceAlert.findFirst({
        where: {
          userId,
          assetId,
          direction,
          threshold,
          status: 'ACTIVE',
          ...(id ? { id: { not: id } } : {}),
        },
      })
    )
      throw new HttpError(
        409,
        'An active alert already has this asset, direction and target.',
      );
  }
  return {
    async list(
      userId: string,
      query: {
        status?: 'ACTIVE' | 'PAUSED' | 'TRIGGERED';
        page: number;
        limit: number;
      },
    ) {
      const where = {
        userId,
        ...(query.status ? { status: query.status } : {}),
      };
      const [alerts, total, activeCount] = await Promise.all([
        db.priceAlert.findMany({
          where,
          include,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: query.limit,
          skip: (query.page - 1) * query.limit,
        }),
        db.priceAlert.count({ where }),
        db.priceAlert.count({ where: { userId, status: 'ACTIVE' } }),
      ]);
      return {
        alerts,
        total,
        activeCount,
        page: query.page,
        limit: query.limit,
      };
    },
    get: (userId: string, id: string) => owned(db, userId, id),
    async events(
      userId: string,
      id: string,
      query: { page: number; limit: number },
    ) {
      // Filter ownership on the event queries as well as the initial existence check.
      await owned(db, userId, id);
      const where = { alertId: id, alert: { userId } };
      const [events, total] = await Promise.all([
        db.alertEvent.findMany({
          where,
          orderBy: [{ triggeredAt: 'desc' }, { id: 'desc' }],
          take: query.limit,
          skip: (query.page - 1) * query.limit,
        }),
        db.alertEvent.count({ where }),
      ]);
      return { events, total, page: query.page, limit: query.limit };
    },
    create(
      userId: string,
      input: {
        assetId: string;
        direction: 'ABOVE' | 'BELOW';
        threshold: string;
      },
    ) {
      return write(userId, async (tx) => {
        const asset = await tx.asset.findFirst({
          where: { id: input.assetId, isActive: true },
        });
        if (!asset)
          throw new HttpError(404, 'Asset not found in the active catalog');
        await capacity(tx, userId);
        await duplicate(tx, userId, asset.id, input.direction, input.threshold);
        const real = asset.type === 'CRYPTO' && !asset.isDemoOnly;
        return tx.priceAlert.create({
          data: {
            ...input,
            userId,
            provider: real ? 'COINPAPRIKA' : 'DEMO',
            mode: real ? 'REAL' : 'DEMO',
            emailEnabled: false,
            armedAt: await clock(tx),
          },
          include,
        });
      });
    },
    edit(
      userId: string,
      id: string,
      input: { direction: 'ABOVE' | 'BELOW'; threshold: string },
    ) {
      return write(userId, async (tx) => {
        await owned(tx, userId, id, true);
        return tx.priceAlert.update({
          where: { id, userId },
          data: { ...input, status: 'PAUSED' },
          include,
        });
      });
    },
    pause(userId: string, id: string) {
      return write(userId, async (tx) => {
        const alert = await owned(tx, userId, id, true);
        return alert.status === 'ACTIVE'
          ? tx.priceAlert.update({
              where: { id, userId },
              data: { status: 'PAUSED' },
              include,
            })
          : alert;
      });
    },
    rearm(userId: string, id: string) {
      return write(userId, async (tx) => {
        const alert = await owned(tx, userId, id, true);
        if (alert.status === 'ACTIVE') return alert;
        if (!alert.asset.isActive)
          throw new HttpError(
            409,
            'This asset is no longer in the active catalog',
          );
        await capacity(tx, userId);
        await duplicate(
          tx,
          userId,
          alert.assetId,
          alert.direction,
          alert.threshold,
          id,
        );
        return tx.priceAlert.update({
          where: { id, userId },
          data: {
            status: 'ACTIVE',
            activation: { increment: 1 },
            armedAt: await clock(tx),
          },
          include,
        });
      });
    },
    delete(userId: string, id: string) {
      return write(userId, async (tx) => {
        await owned(tx, userId, id, true);
        await tx.priceAlert.delete({ where: { id, userId } });
      });
    },
  };
}
