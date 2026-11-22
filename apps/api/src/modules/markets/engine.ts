import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { MarketSettings } from '../../config/markets.js';
import type { MarketProvider } from '../../providers/market-provider.js';
import {
  MarketDeferred,
  ProviderFailure,
  historyId,
  historyTtl,
  type BudgetWindow,
  type CatalogAsset,
  type MarketStore,
  type Source,
} from './types.js';

export function budgetWindows(
  config: MarketSettings,
  now: number,
  category: 'quotes' | 'history',
  retry = false,
): BudgetWindow[] {
  const start = config.CG_BILLING_START
    ? Date.parse(config.CG_BILLING_START)
    : NaN;
  const end = config.CG_BILLING_END ? Date.parse(config.CG_BILLING_END) : NaN;
  if (
    !config.COINGECKO_LIVE_ENABLED ||
    !config.COINGECKO_API_KEY ||
    !Number.isFinite(start) ||
    !Number.isFinite(end)
  )
    throw new MarketDeferred('not_configured', now + 3600_000);
  if (now < start || now >= end)
    throw new MarketDeferred(
      'billing_window_inactive',
      now < start ? start : now + 3600_000,
    );
  const minute = Math.floor(now / 60_000) * 60_000;
  const day = Math.floor(now / 86400_000) * 86400_000;
  return [
    {
      category: 'all:minute',
      start: minute,
      end: minute + 60_000,
      limit: config.CG_MINUTE_ATTEMPT_LIMIT,
    },
    {
      category: 'all:day',
      start: day,
      end: day + 86400_000,
      limit: config.CG_DAILY_ATTEMPT_LIMIT,
    },
    {
      category: 'all:month',
      start,
      end,
      limit: config.CG_MONTHLY_ATTEMPT_LIMIT,
    },
    ...(category === 'history'
      ? [
          {
            category: 'charts:day',
            start: day,
            end: day + 86400_000,
            limit: config.CG_CHART_DAILY_LIMIT,
          },
        ]
      : retry
        ? []
        : [{ category: 'quotes:month', start, end, limit: 4464 }]),
    ...(retry ? [{ category: 'retry:month', start, end, limit: 1025 }] : []),
  ];
}
export type Clock = {
  now(): number;
  sleep(ms: number): Promise<unknown>;
  random(): number;
};
const defaultClock: Clock = {
  now: Date.now,
  sleep: delay,
  random: Math.random,
};
export function createMarketEngine(
  store: MarketStore,
  providers: Map<Source, MarketProvider>,
  settings: MarketSettings,
  clock: Clock = defaultClock,
) {
  async function execute<T>(
    provider: MarketProvider,
    category: 'quotes' | 'history',
    task: () => Promise<T>,
  ): Promise<T> {
    const owner = randomUUID();
    const lock = `market:provider:${provider.source}`;
    if (!(await store.acquire(lock, owner, clock.now(), clock.now() + 60_000)))
      throw new MarketDeferred('busy', clock.now() + 15_000);
    try {
      const state = await store.state(provider.source);
      if (state.disabled)
        throw new MarketDeferred('unauthorized', clock.now() + 3600_000);
      if (state.blockedUntil && state.blockedUntil > clock.now())
        throw new MarketDeferred(
          state.lastError ?? 'circuit_open',
          state.blockedUntil,
        );
      const attempts = state.failures >= 3 ? 1 : 3; // One recovery probe when the circuit opens.
      for (let attempt = 0; attempt < attempts; attempt++) {
        const windows =
          provider.source === 'COINGECKO'
            ? budgetWindows(settings, clock.now(), category, attempt > 0)
            : [];
        if (windows.length) await store.reserve(provider.source, windows);
        let failure: ProviderFailure | undefined;
        let result: T | undefined;
        try {
          result = await task();
        } catch (error) {
          failure =
            error instanceof ProviderFailure
              ? error
              : new ProviderFailure('invalid_data');
        } finally {
          if (windows.length) await store.settle(provider.source, windows);
        }
        if (!failure) {
          await store.setState({
            provider: provider.source,
            failures: 0,
            disabled: false,
            blockedUntil: null,
            lastSuccessAt: clock.now(),
            lastError: null,
          });
          return result as T;
        }
        if (failure.retryable && attempt < attempts - 1) {
          await clock.sleep(
            1000 * 2 ** attempt + Math.floor(clock.random() * 250),
          );
          continue;
        }
        const failures = state.failures + 1;
        const retryAt =
          failure.retryAt ??
          clock.now() +
            (failures >= 3
              ? Math.min(15 * 60_000, 60_000 * 2 ** Math.min(8, failures - 3))
              : 60_000);
        await store.setState({
          ...state,
          failures,
          disabled: failure.reason === 'unauthorized',
          blockedUntil: retryAt,
          lastError: failure.reason,
        });
        throw new MarketDeferred(failure.reason, retryAt);
      }
      throw new MarketDeferred('upstream_error', clock.now() + 60_000);
    } finally {
      await store.release(lock, owner);
    }
  }
  const selection = (asset: CatalogAsset): Source =>
    asset.type === 'CRYPTO' && settings.CRYPTO_DATA_MODE === 'coingecko'
      ? 'COINGECKO'
      : 'DEMO';
  async function tick() {
    const assets = await store.assets();
    // Quote batches have priority over chart jobs. Cooldowns persist across restarts.
    for (const provider of providers.values()) {
      const group = assets.filter(
        (asset) => selection(asset) === provider.source,
      );
      if (!group.length) continue;
      const owner = randomUUID();
      const key = `market:quotes:${provider.source}`;
      const period = provider.source === 'DEMO' ? 60_000 : 600_000;
      if (!(await store.acquire(key, owner, clock.now(), clock.now() + period)))
        continue;
      try {
        const quotes = await execute(provider, 'quotes', () =>
          provider.quotes(group, clock.now()),
        );
        await store.saveQuotes(
          quotes.map((row) => ({
            ...row,
            provider: provider.source,
            mode: provider.mode,
            fetchedAt: clock.now(),
          })),
        );
      } catch (error) {
        if (!(error instanceof MarketDeferred)) throw error;
        if (error.reason === 'busy') await store.release(key, owner);
      }
    }
    for (const key of await store.pending(clock.now(), 4)) {
      const asset = assets.find((asset) => asset.id === key.assetId);
      if (!asset || selection(asset) !== key.provider) {
        await store.failHistory(
          key,
          'source_not_enabled',
          clock.now() + 3600_000,
        );
        continue;
      }
      const provider = providers.get(key.provider);
      if (!provider) continue;
      const owner = randomUUID();
      const lock = `market:history:${historyId(key)}`;
      if (
        !(await store.acquire(lock, owner, clock.now(), clock.now() + 60_000))
      )
        continue;
      try {
        // Another process may have completed the cache before this lease was acquired.
        const cached = await store.history(key, clock.now());
        if (!cached?.pending || cached.nextAttemptAt > clock.now()) continue;
        const points = await execute(provider, 'history', () =>
          provider.history(asset, key.range, clock.now()),
        );
        await store.saveHistory(
          key,
          points,
          clock.now(),
          historyTtl[key.range],
        );
      } catch (error) {
        if (!(error instanceof MarketDeferred)) throw error;
        await store.failHistory(key, error.reason, error.retryAt);
      } finally {
        await store.release(lock, owner);
      }
    }
    const owner = randomUUID();
    if (
      await store.acquire(
        'market:cleanup',
        owner,
        clock.now(),
        clock.now() + 60_000,
      )
    )
      await store.cleanup(clock.now());
  }
  return { tick, selection };
}
