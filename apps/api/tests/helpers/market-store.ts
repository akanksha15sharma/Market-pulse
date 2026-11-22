import { randomUUID } from 'node:crypto';
import { cryptoCatalog, stockCatalog } from '../../prisma/catalog.js';
import {
  MarketDeferred,
  historyId,
  type BudgetWindow,
  type CachedQuote,
  type CatalogAsset,
  type HistorySnapshot,
  type MarketStore,
  type ProviderState,
  type Source,
} from '../../src/modules/markets/types.js';

export function catalog(): CatalogAsset[] {
  return [
    ...cryptoCatalog.map(([externalId, symbol, name]) => ({
      id: randomUUID(),
      key: `crypto:${externalId}`,
      symbol,
      name,
      type: 'CRYPTO' as const,
      exchange: null,
      quoteCurrency: 'USD' as const,
      isDemoOnly: false,
      mappings: [
        { provider: 'COINGECKO', externalId },
        { provider: 'DEMO', externalId: `crypto:${externalId}` },
      ],
    })),
    ...stockCatalog.map(([symbol, name]) => ({
      id: randomUUID(),
      key: `stock:NASDAQ:${symbol}`,
      symbol,
      name,
      type: 'STOCK' as const,
      exchange: 'NASDAQ',
      quoteCurrency: 'USD' as const,
      isDemoOnly: true,
      mappings: [{ provider: 'DEMO', externalId: symbol }],
    })),
  ];
}
const windowId = (provider: Source, window: BudgetWindow) =>
  `${provider}:${window.category}:${window.start}:${window.end}`;
export function memoryStore(assets = catalog()) {
  const quotes = new Map<string, CachedQuote>();
  const histories = new Map<string, HistorySnapshot>();
  const states = new Map<Source, ProviderState>();
  const leases = new Map<string, { owner: string; until: number }>();
  const usage = new Map<string, { reserved: number; consumed: number }>();
  const store: MarketStore = {
    assets: async () => assets,
    quotes: async () => [...quotes.values()],
    async saveQuotes(rows) {
      for (const row of rows) {
        const key = `${row.assetId}:${row.provider}:${row.mode}`;
        const old = quotes.get(key);
        if (!old || old.sourceAt < row.sourceAt) quotes.set(key, row);
      }
    },
    history: async (key) => histories.get(historyId(key)) ?? null,
    async enqueue(key, now) {
      const id = historyId(key);
      const old = histories.get(id);
      if (
        old?.freshUntil &&
        old.freshUntil > now &&
        old.expiresAt &&
        old.expiresAt > now
      )
        return;
      histories.set(
        id,
        old
          ? { ...old, pending: true }
          : {
              ...key,
              points: [],
              fetchedAt: null,
              freshUntil: null,
              expiresAt: null,
              pending: true,
              nextAttemptAt: now,
              lastError: null,
            },
      );
    },
    pending: async (now, limit) =>
      [...histories.values()]
        .filter((row) => row.pending && row.nextAttemptAt <= now)
        .slice(0, limit),
    async saveHistory(key, points, now, ttl) {
      histories.set(historyId(key), {
        ...key,
        points,
        fetchedAt: now,
        freshUntil: now + ttl,
        expiresAt: now + 48 * 3600_000,
        pending: false,
        nextAttemptAt: now,
        lastError: null,
      });
    },
    async failHistory(key, lastError, retryAt) {
      const old = histories.get(historyId(key));
      if (old)
        histories.set(historyId(key), {
          ...old,
          pending: true,
          lastError,
          nextAttemptAt: retryAt,
        });
    },
    async acquire(key, owner, now, until) {
      const old = leases.get(key);
      if (old && old.until > now) return false;
      leases.set(key, { owner, until });
      return true;
    },
    async release(key, owner) {
      if (leases.get(key)?.owner === owner) leases.delete(key);
    },
    state: async (provider) =>
      states.get(provider) ?? {
        provider,
        failures: 0,
        disabled: false,
        blockedUntil: null,
        lastError: null,
        lastSuccessAt: null,
      },
    async setState(state) {
      states.set(state.provider, { ...state });
    },
    async reserve(provider, windows) {
      for (const window of windows) {
        const used = usage.get(windowId(provider, window));
        if ((used?.reserved ?? 0) + (used?.consumed ?? 0) >= window.limit)
          throw new MarketDeferred('quota_exhausted', window.end);
      }
      for (const window of windows) {
        const id = windowId(provider, window);
        const old = usage.get(id) ?? { reserved: 0, consumed: 0 };
        usage.set(id, { ...old, reserved: old.reserved + 1 });
      }
    },
    async settle(provider, windows) {
      for (const window of windows) {
        const old = usage.get(windowId(provider, window))!;
        old.reserved--;
        old.consumed++;
      }
    },
    usage: async (provider, windows) =>
      windows.map((window) => {
        const old = usage.get(windowId(provider, window));
        return { ...window, used: (old?.reserved ?? 0) + (old?.consumed ?? 0) };
      }),
    async cleanup() {},
  };
  return { store, assets, quotes, histories, states, leases, usage };
}
