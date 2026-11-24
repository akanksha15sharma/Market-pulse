import { marketSettings, nativeMarketsAllowed } from '../../config/markets.js';
import { ALERT_MAX_AGE_MS } from '@marketpulse/contracts';
import {
  Prisma,
  type PriceAlert,
  type Asset,
} from '../../generated/prisma/client.js';
import type { CachedQuote } from '../markets/types.js';
export type EvaluationAlert = Pick<
  PriceAlert,
  | 'assetId'
  | 'provider'
  | 'mode'
  | 'status'
  | 'armedAt'
  | 'threshold'
  | 'direction'
> & { asset: Pick<Asset, 'isActive' | 'isDemoOnly' | 'type'> };
export function canTrigger(
  alert: EvaluationAlert,
  quote: CachedQuote,
  now: number,
) {
  if (
    alert.status !== 'ACTIVE' ||
    alert.assetId !== quote.assetId ||
    !alert.asset.isActive ||
    alert.asset.isDemoOnly ||
    alert.asset.type !== 'CRYPTO' ||
    alert.provider !== 'COINPAPRIKA' ||
    alert.mode !== 'REAL' ||
    quote.provider !== 'COINPAPRIKA' ||
    quote.mode !== 'REAL'
  )
    return false;
  if (
    ![now, quote.sourceAt, quote.fetchedAt, alert.armedAt.getTime()].every(
      Number.isFinite,
    ) ||
    quote.sourceAt <= alert.armedAt.getTime() ||
    quote.fetchedAt <= alert.armedAt.getTime() ||
    quote.sourceAt > quote.fetchedAt ||
    quote.fetchedAt > now ||
    now - quote.sourceAt > ALERT_MAX_AGE_MS ||
    now - quote.fetchedAt > ALERT_MAX_AGE_MS
  )
    return false;
  try {
    const price = new Prisma.Decimal(quote.price);
    const target = new Prisma.Decimal(alert.threshold);
    if (
      !price.isFinite() ||
      !price.gt(0) ||
      !target.isFinite() ||
      !target.gt(0)
    )
      return false;
    return alert.direction === 'ABOVE' ? price.gte(target) : price.lte(target);
  } catch {
    return false;
  }
}
// Called only for newer quotes accepted by the cache, inside that same transaction.
export async function evaluateQuote(
  tx: Prisma.TransactionClient,
  quote: CachedQuote,
) {
  if (!nativeMarketsAllowed(marketSettings)) return;
  if (quote.provider !== 'COINPAPRIKA' || quote.mode !== 'REAL') return;
  const locked = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM price_alerts WHERE "assetId" = ${quote.assetId}::uuid AND provider = 'COINPAPRIKA' AND mode = 'REAL' AND status = 'ACTIVE' ORDER BY id FOR UPDATE`;
  if (!locked.length) return;
  const now = (
    await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`
  )[0]!.now;
  const alerts = await tx.priceAlert.findMany({
    where: { id: { in: locked.map((row) => row.id) } },
    include: { asset: true },
  });
  for (const alert of alerts) {
    if (!canTrigger(alert, quote, now.getTime())) continue;
    await tx.alertEvent.upsert({
      where: {
        alertId_activation: { alertId: alert.id, activation: alert.activation },
      },
      update: {},
      create: {
        alertId: alert.id,
        activation: alert.activation,
        observedPrice: quote.price,
        sourceAt: new Date(quote.sourceAt),
        fetchedAt: new Date(quote.fetchedAt),
        triggeredAt: now,
        targetPrice: alert.threshold,
        direction: alert.direction,
        provider: 'COINPAPRIKA',
        mode: 'REAL',
      },
    });
    await tx.priceAlert.update({
      where: { id: alert.id, activation: alert.activation, status: 'ACTIVE' },
      data: { status: 'TRIGGERED' },
    });
  }
}
