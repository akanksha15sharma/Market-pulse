import type { HistoryRange, MarketAsset } from '@marketpulse/contracts';
export type Source = 'DEMO' | 'COINPAPRIKA';
export type Mode = 'DEMO' | 'REAL';
export type CatalogAsset = MarketAsset & {
  mappings: { provider: string; externalId: string }[];
};
export type Point = { timestamp: number; price: string };
export type NormalizedQuote = {
  assetId: string;
  price: string;
  changePercent: string | null;
  sourceAt: number;
};
export type CachedQuote = NormalizedQuote & {
  provider: Source;
  mode: Mode;
  fetchedAt: number;
};
export type HistoryKey = {
  assetId: string;
  provider: Source;
  mode: Mode;
  range: HistoryRange;
};
export type HistorySnapshot = HistoryKey & {
  points: Point[];
  fetchedAt: number | null;
  freshUntil: number | null;
  expiresAt: number | null;
  pending: boolean;
  nextAttemptAt: number;
  lastError: string | null;
};
export type ProviderState = {
  provider: Source;
  failures: number;
  disabled: boolean;
  blockedUntil: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
};
export type BudgetWindow = {
  category: string;
  start: number;
  end: number;
  limit: number;
};
export type Usage = BudgetWindow & { used: number };
export type MarketStore = {
  assets(): Promise<CatalogAsset[]>;
  quotes(): Promise<CachedQuote[]>;
  saveQuotes(rows: CachedQuote[]): Promise<void>;
  history(key: HistoryKey, now: number): Promise<HistorySnapshot | null>;
  enqueue(key: HistoryKey, now: number): Promise<void>;
  pending(now: number, limit: number): Promise<HistoryKey[]>;
  saveHistory(
    key: HistoryKey,
    points: Point[],
    now: number,
    ttl: number,
  ): Promise<void>;
  failHistory(key: HistoryKey, reason: string, retryAt: number): Promise<void>;
  acquire(
    key: string,
    owner: string,
    now: number,
    until: number,
  ): Promise<boolean>;
  release(key: string, owner: string): Promise<void>;
  state(provider: Source): Promise<ProviderState>;
  setState(state: ProviderState): Promise<void>;
  reserve(provider: Source, windows: BudgetWindow[]): Promise<void>;
  settle(provider: Source, windows: BudgetWindow[]): Promise<void>;
  usage(provider: Source, windows: BudgetWindow[]): Promise<Usage[]>;
  cleanup(now: number): Promise<void>;
};
export class MarketDeferred extends Error {
  constructor(
    public readonly reason: string,
    public readonly retryAt: number,
  ) {
    super(reason);
  }
}
export class ProviderFailure extends Error {
  constructor(
    public readonly reason:
      | 'history_unavailable'
      | 'network_error'
      | 'rate_limited'
      | 'unauthorized'
      | 'invalid_data'
      | 'upstream_error',
    public readonly retryable = false,
    public readonly retryAt?: number,
  ) {
    super(reason);
  }
}
export const rangeDays = { '1D': 1, '7D': 7, '1M': 30, '1Y': 365 } as const;
export const historyTtl = {
  '1D': 30 * 60_000,
  '7D': 6 * 3600_000,
  '1M': 6 * 3600_000,
  '1Y': 24 * 3600_000,
} as const;
export const granularity = (range: HistoryRange, provider: Source = 'DEMO') =>
  provider === 'COINPAPRIKA'
    ? range === '1D'
      ? ('1h' as const)
      : ('1d' as const)
    : range === '1D'
      ? ('5m' as const)
      : range === '1Y'
        ? ('1d' as const)
        : ('1h' as const);
export const historyId = (key: HistoryKey) =>
  `${key.assetId}:${key.provider}:${key.mode}:${key.range}`;
