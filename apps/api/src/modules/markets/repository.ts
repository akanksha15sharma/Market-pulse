import type { PrismaClient, Prisma } from '../../generated/prisma/client.js';
import type { HistoryRange } from '@marketpulse/contracts';
import {
  MarketDeferred,
  granularity,
  type BudgetWindow,
  type HistoryKey,
  type MarketStore,
  type Source,
} from './types.js';

const date = (value: number | null) =>
  value === null ? null : new Date(value);
const stamp = (value: Date | null) => value?.getTime() ?? null;
const filter = (key: HistoryKey) => ({ ...key, currency: 'USD' });
const unique = (key: HistoryKey) => ({
  assetId_provider_mode_currency_range: filter(key),
});
function usageKey(provider: Source, window: BudgetWindow) {
  return {
    provider,
    category: window.category,
    windowStart: new Date(window.start),
    windowEnd: new Date(window.end),
  };
}

export function createMarketRepository(db: PrismaClient): MarketStore {
  return {
    async assets() {
      const rows = await db.asset.findMany({
        where: { isActive: true },
        include: { mappings: true },
        orderBy: { key: 'asc' },
      });
      return rows.map((row) => ({
        id: row.id,
        key: row.key,
        symbol: row.symbol,
        name: row.name,
        type: row.type,
        exchange: row.exchange,
        quoteCurrency: 'USD',
        isDemoOnly: row.isDemoOnly,
        mappings: row.mappings.map((mapping) => ({
          provider: mapping.provider,
          externalId: mapping.providerAssetId,
        })),
      }));
    },
    async quotes() {
      const rows = await db.latestQuote.findMany({
        where: { provider: { in: ['DEMO', 'COINGECKO'] }, currency: 'USD' },
      });
      return rows.map((row) => ({
        assetId: row.assetId,
        provider: row.provider as Source,
        mode: row.mode,
        price: row.price.toFixed(18),
        changePercent: row.changePercent?.toFixed(8) ?? null,
        sourceAt: row.sourceAt.getTime(),
        fetchedAt: row.fetchedAt.getTime(),
      }));
    },
    async saveQuotes(rows) {
      await db.$transaction(async (tx) => {
        for (const row of rows) {
          // Atomic source-time guard protects against delayed workers and restarts.
          await tx.$executeRaw`INSERT INTO latest_quotes ("assetId", provider, mode, currency, price, "changePercent", "sourceAt", "fetchedAt") VALUES (${row.assetId}::uuid, ${row.provider}::"Provider", ${row.mode}::"DataMode", 'USD', ${row.price}::numeric, ${row.changePercent}::numeric, ${new Date(row.sourceAt)}, ${new Date(row.fetchedAt)}) ON CONFLICT ("assetId", provider, mode, currency) DO UPDATE SET price = EXCLUDED.price, "changePercent" = EXCLUDED."changePercent", "sourceAt" = EXCLUDED."sourceAt", "fetchedAt" = EXCLUDED."fetchedAt" WHERE latest_quotes."sourceAt" < EXCLUDED."sourceAt"`;
        }
      });
    },
    async history(key, now) {
      const metadata = await db.historyCache.findUnique({ where: unique(key) });
      if (!metadata) return null;
      const rows =
        metadata.expiresAt && metadata.expiresAt.getTime() > now
          ? await db.historicalBar.findMany({
              where: { ...filter(key), expiresAt: { gt: new Date(now) } },
              orderBy: { timestamp: 'asc' },
            })
          : [];
      return {
        ...key,
        points: rows.map((row) => ({
          timestamp: row.timestamp.getTime(),
          price: row.close.toFixed(18),
        })),
        fetchedAt: stamp(metadata.fetchedAt),
        freshUntil: stamp(metadata.freshUntil),
        expiresAt: stamp(metadata.expiresAt),
        pending: metadata.pending,
        nextAttemptAt: metadata.nextAttemptAt.getTime(),
        lastError: metadata.lastError,
      };
    },
    async enqueue(key, now) {
      // A late reader must not requeue a cache another worker just refreshed.
      await db.$executeRaw`INSERT INTO history_caches ("assetId", provider, mode, currency, range, pending, "nextAttemptAt") VALUES (${key.assetId}::uuid, ${key.provider}::"Provider", ${key.mode}::"DataMode", 'USD', ${key.range}, true, ${new Date(now)}) ON CONFLICT ("assetId", provider, mode, currency, range) DO UPDATE SET pending = true WHERE history_caches."freshUntil" IS NULL OR history_caches."freshUntil" <= ${new Date(now)} OR history_caches."expiresAt" IS NULL OR history_caches."expiresAt" <= ${new Date(now)}`;
    },
    async pending(now, limit) {
      const rows = await db.historyCache.findMany({
        where: {
          pending: true,
          nextAttemptAt: { lte: new Date(now) },
          provider: { in: ['DEMO', 'COINGECKO'] },
        },
        orderBy: { nextAttemptAt: 'asc' },
        take: limit,
      });
      return rows.map((row) => ({
        assetId: row.assetId,
        provider: row.provider as Source,
        mode: row.mode,
        range: row.range as HistoryRange,
      }));
    },
    async saveHistory(key, points, now, ttl) {
      await db.$transaction(async (tx) => {
        await tx.historicalBar.deleteMany({ where: filter(key) });
        await tx.historicalBar.createMany({
          data: points.map((point) => ({
            ...filter(key),
            interval: granularity(key.range),
            timestamp: new Date(point.timestamp),
            close: point.price,
            expiresAt: new Date(now + 48 * 3600_000),
          })),
        });
        await tx.historyCache.update({
          where: unique(key),
          data: {
            fetchedAt: new Date(now),
            freshUntil: new Date(now + ttl),
            expiresAt: new Date(now + 48 * 3600_000),
            pending: false,
            lastError: null,
            nextAttemptAt: new Date(now),
          },
        });
      });
    },
    async failHistory(key, lastError, retryAt) {
      await db.historyCache.update({
        where: unique(key),
        data: { lastError, nextAttemptAt: new Date(retryAt), pending: true },
      });
    },
    async acquire(key, owner, now, until) {
      const result = await db.$queryRaw<
        { key: string }[]
      >`INSERT INTO scheduler_leases (key, owner, "expiresAt") VALUES (${key}, ${owner}, ${new Date(until)}) ON CONFLICT (key) DO UPDATE SET owner = EXCLUDED.owner, "expiresAt" = EXCLUDED."expiresAt" WHERE scheduler_leases."expiresAt" <= ${new Date(now)} RETURNING key`;
      return result.length === 1;
    },
    async release(key, owner) {
      await db.schedulerLease.deleteMany({ where: { key, owner } });
    },
    async state(provider) {
      const row = await db.marketProviderState.findUnique({
        where: { provider },
      });
      return row
        ? {
            provider,
            failures: row.failures,
            disabled: row.disabled,
            blockedUntil: stamp(row.blockedUntil),
            lastSuccessAt: stamp(row.lastSuccessAt),
            lastError: row.lastError,
          }
        : {
            provider,
            failures: 0,
            disabled: false,
            blockedUntil: null,
            lastSuccessAt: null,
            lastError: null,
          };
    },
    async setState(state) {
      const data = {
        ...state,
        blockedUntil: date(state.blockedUntil),
        lastSuccessAt: date(state.lastSuccessAt),
      };
      await db.marketProviderState.upsert({
        where: { provider: state.provider },
        create: data,
        update: data,
      });
    },
    async reserve(provider, windows) {
      await db.$transaction(async (tx) => {
        // Stable lock order, and rollback all windows if any window is exhausted.
        for (const window of [...windows].sort((a, b) =>
          a.category.localeCompare(b.category),
        )) {
          const rows = await tx.$queryRaw<
            { reserved: number }[]
          >`INSERT INTO provider_usage (provider, category, "windowStart", "windowEnd", reserved, consumed) VALUES (${provider}::"Provider", ${window.category}, ${new Date(window.start)}, ${new Date(window.end)}, 1, 0) ON CONFLICT (provider, category, "windowStart", "windowEnd") DO UPDATE SET reserved = provider_usage.reserved + 1 WHERE provider_usage.reserved + provider_usage.consumed < ${window.limit} RETURNING reserved`;
          if (!rows.length)
            throw new MarketDeferred('quota_exhausted', window.end);
        }
      });
    },
    async settle(provider, windows) {
      await db.$transaction(async (tx) => {
        for (const window of [...windows].sort((a, b) =>
          a.category.localeCompare(b.category),
        )) {
          await tx.providerUsage.update({
            where: {
              provider_category_windowStart_windowEnd: usageKey(
                provider,
                window,
              ),
            },
            data: { reserved: { decrement: 1 }, consumed: { increment: 1 } },
          });
        }
      });
    },
    async usage(provider, windows) {
      const rows = await db.providerUsage.findMany({
        where: { OR: windows.map((window) => usageKey(provider, window)) },
      });
      return windows.map((window) => ({
        ...window,
        used: rows
          .filter(
            (row) =>
              row.category === window.category &&
              row.windowStart.getTime() === window.start &&
              row.windowEnd.getTime() === window.end,
          )
          .reduce((sum, row) => sum + row.consumed + row.reserved, 0),
      }));
    },
    async cleanup(now) {
      await db.$transaction([
        db.historicalBar.deleteMany({
          where: { expiresAt: { lte: new Date(now) } },
        }),
        db.historyCache.deleteMany({
          where: { pending: false, expiresAt: { lte: new Date(now) } },
        }),
        db.providerUsage.deleteMany({
          where: { windowEnd: { lt: new Date(now - 86400_000) } },
        }),
      ] as Prisma.PrismaPromise<unknown>[]);
    },
  };
}
