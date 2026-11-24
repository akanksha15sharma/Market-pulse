import {
  assetSchema,
  historySourceMaxAge,
  historyResponseSchema,
  quoteSchema,
  type HistoryRange,
  type MarketAsset,
} from '@marketpulse/contracts';
import { HttpError } from '../../lib/http-error.js';
import {
  nativeMarketsAllowed,
  type MarketSettings,
} from '../../config/markets.js';
import { budgetWindows } from './engine.js';
import {
  granularity,
  MarketDeferred,
  type CatalogAsset,
  type MarketStore,
  type Source,
} from './types.js';

export function createMarketService(
  store: MarketStore,
  config: MarketSettings,
  activate: () => void = () => {},
  now: () => number = Date.now,
) {
  const allowed = nativeMarketsAllowed(config);
  const activateIfAllowed = () => {
    if (allowed) activate();
  };
  const source = (asset: CatalogAsset): Source =>
    asset.type === 'CRYPTO' && config.CRYPTO_DATA_MODE === 'coinpaprika'
      ? 'COINPAPRIKA'
      : 'DEMO';
  const mode = (provider: Source) =>
    provider === 'DEMO' ? ('DEMO' as const) : ('REAL' as const);
  function unavailableReason(provider: Source) {
    if (provider === 'COINPAPRIKA') {
      try {
        budgetWindows(config, now(), 'quotes');
      } catch (error) {
        if (error instanceof MarketDeferred) return error.reason;
        throw error;
      }
    }
    return null;
  }
  async function asset(id: string) {
    const result = (await store.assets()).find((row) => row.id === id);
    if (!result) throw new HttpError(404, 'Asset not found');
    return result;
  }
  return {
    async list(query: {
      q: string;
      type?: 'CRYPTO' | 'STOCK';
      sort: 'symbol' | 'name';
      page: number;
      limit: number;
    }) {
      const search = query.q.toLowerCase();
      const rows = (await store.assets())
        .filter(
          (row) =>
            (!query.type || row.type === query.type) &&
            `${row.symbol} ${row.name}`.toLowerCase().includes(search),
        )
        .sort(
          (a, b) =>
            a[query.sort].localeCompare(b[query.sort]) ||
            a.id.localeCompare(b.id),
        );
      activateIfAllowed();
      return {
        assets: rows
          .slice((query.page - 1) * query.limit, query.page * query.limit)
          .map((row) => assetSchema.parse(row)),
        total: rows.length,
        page: query.page,
        limit: query.limit,
      };
    },
    async detail(id: string): Promise<MarketAsset> {
      const row = await asset(id);
      activateIfAllowed();
      return assetSchema.parse(row);
    },
    async quotes(ids?: string[]) {
      const all = await store.assets();
      const unique = ids ? [...new Set(ids)] : all.map((row) => row.id);
      if (unique.some((id) => !all.some((row) => row.id === id)))
        throw new HttpError(404, 'Asset not found');
      if (!allowed) return { quotes: [] };
      const cached = await store.quotes();
      const states = new Map(
        await Promise.all(
          [...new Set(all.map(source))].map(
            async (provider) =>
              [provider, await store.state(provider)] as const,
          ),
        ),
      );
      activateIfAllowed();
      return {
        quotes: unique.map((id) => {
          const row = all.find((value) => value.id === id)!;
          const provider = source(row);
          const quote = cached.find(
            (value) =>
              value.assetId === id &&
              value.provider === provider &&
              value.mode === mode(provider),
          );
          const stale = quote
            ? now() - quote.sourceAt >
                (provider === 'DEMO' ? 120_000 : 1200_000) ||
              quote.sourceAt > now() + 60_000
            : true;
          return quoteSchema.parse({
            assetId: id,
            provider,
            mode: mode(provider),
            currency: 'USD',
            simulated: provider === 'DEMO',
            status: quote ? (stale ? 'stale' : 'fresh') : 'unavailable',
            price: quote?.price ?? null,
            changePercent: quote?.changePercent ?? null,
            sourceAt: quote ? new Date(quote.sourceAt).toISOString() : null,
            fetchedAt: quote ? new Date(quote.fetchedAt).toISOString() : null,
            reason:
              !quote || stale
                ? (states.get(provider)?.lastError ??
                  unavailableReason(provider) ??
                  (quote ? 'stale_observation' : 'not_cached'))
                : null,
          });
        }),
      };
    },
    async history(id: string, range: HistoryRange) {
      const row = await asset(id);
      if (!allowed)
        throw new HttpError(
          503,
          'Native price history is unavailable; use the market chart.',
        );
      const provider = source(row);
      const key = { assetId: id, provider, mode: mode(provider), range };
      let cached = await store.history(key, now());
      const isUsable = () =>
        cached?.expiresAt !== null &&
        (cached?.expiresAt ?? 0) > now() &&
        !!cached?.points.length;
      let usable = isUsable();
      let cacheFresh = usable && (cached?.freshUntil ?? 0) > now();
      if (!cacheFresh) {
        await store.enqueue(key, now());
        cached = await store.history(key, now());
        usable = isUsable();
        cacheFresh = usable && (cached?.freshUntil ?? 0) > now();
      }
      activateIfAllowed();
      const sourceAt = usable
        ? Math.max(...cached!.points.map((point) => point.timestamp))
        : null;
      const sourceFresh =
        sourceAt !== null &&
        sourceAt <= now() + 60_000 &&
        now() - sourceAt <= historySourceMaxAge(range, provider);
      const fresh = cacheFresh && sourceFresh;
      const result = historyResponseSchema.parse({
        ...key,
        currency: 'USD',
        simulated: provider === 'DEMO',
        status: usable ? (fresh ? 'fresh' : 'stale') : 'unavailable',
        refresh: cached?.pending ? 'pending' : 'idle',
        granularity: granularity(range, provider),
        fetchedAt: cached?.fetchedAt
          ? new Date(cached.fetchedAt).toISOString()
          : null,
        sourceAt: sourceAt === null ? null : new Date(sourceAt).toISOString(),
        freshUntil: cached?.freshUntil
          ? new Date(cached.freshUntil).toISOString()
          : null,
        expiresAt: cached?.expiresAt
          ? new Date(cached.expiresAt).toISOString()
          : null,
        reason: fresh
          ? null
          : (cached?.lastError ??
            (usable
              ? 'stale_observation'
              : (unavailableReason(provider) ?? 'pending'))),
        points: usable
          ? cached!.points.map((point) => ({
              timestamp: new Date(point.timestamp).toISOString(),
              price: point.price,
            }))
          : [],
      });
      return { status: usable ? 200 : 202, body: result };
    },
    async status() {
      const providers = await Promise.all(
        (['DEMO', 'COINPAPRIKA'] as const).map(async (provider) => {
          const state = await store.state(provider);
          let budgets: {
            category: string;
            remaining: number;
            resetsAt: string;
          }[] = [];
          let reason: string | null = null;
          if (provider === 'COINPAPRIKA') {
            try {
              budgets = (
                await store.usage(provider, [
                  ...new Map(
                    [
                      ...budgetWindows(config, now(), 'history'),
                      ...budgetWindows(config, now(), 'quotes'),
                    ].map((window) => [window.category, window]),
                  ).values(),
                ])
              ).map((window) => ({
                category: window.category,
                remaining: Math.max(0, window.limit - window.used),
                resetsAt: new Date(window.end).toISOString(),
              }));
            } catch (error) {
              if (error instanceof MarketDeferred) reason = error.reason;
              else throw error;
            }
          }
          const blocking =
            reason ??
            (state.disabled
              ? 'unauthorized'
              : state.blockedUntil && state.blockedUntil > now()
                ? (state.lastError ?? 'circuit_open')
                : null);
          const exhausted = (category: 'quotes' | 'history') =>
            budgets.some(
              (budget) =>
                budget.remaining === 0 &&
                (budget.category.startsWith('all:') ||
                  budget.category ===
                    (category === 'quotes' ? 'quotes:month' : 'charts:day')),
            );
          return {
            provider,
            quoteReason:
              blocking ?? (exhausted('quotes') ? 'quota_exhausted' : null),
            historyReason:
              blocking ?? (exhausted('history') ? 'quota_exhausted' : null),
            enabled:
              provider === 'DEMO' ||
              (config.CRYPTO_DATA_MODE === 'coinpaprika' &&
                !reason &&
                !state.disabled),
            disabled: state.disabled,
            lastError: reason ?? state.lastError,
            blockedUntil: state.blockedUntil
              ? new Date(state.blockedUntil).toISOString()
              : null,
            lastSuccessAt: state.lastSuccessAt
              ? new Date(state.lastSuccessAt).toISOString()
              : null,
            budgets,
          };
        }),
      );
      return {
        cryptoMode: config.CRYPTO_DATA_MODE,
        stockMode: 'demo',
        refreshSeconds: {
          crypto: config.CRYPTO_DATA_MODE === 'coinpaprika' ? 600 : 60,
          stocks: 60,
        },
        workerEnabled: config.MARKET_WORKER_ENABLED,
        alwaysOn: config.MARKET_ALWAYS_ON,
        attribution:
          'Powered by CoinPaprika when real crypto mode is enabled. Demo prices are synthetic.',
        providers,
      };
    },
  };
}
export type MarketService = ReturnType<typeof createMarketService>;
