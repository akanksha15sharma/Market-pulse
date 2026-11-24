import { z } from 'zod';
import {
  assetSchema,
  historyResponseSchema,
  quoteSchema,
  marketStatusSchema,
  type HistoryRange,
} from '@marketpulse/contracts';

const catalogSchema = z.object({
  assets: z.array(assetSchema),
  total: z.number(),
});
const quotesSchema = z.object({ quotes: z.array(quoteSchema) });
const statusSchema = marketStatusSchema;
export type History = z.infer<typeof historyResponseSchema>;
export type Overview = Awaited<ReturnType<typeof loadOverview>>;
export class MarketRequestError extends Error {
  constructor(
    message: string,
    public readonly retryMs = 60_000,
  ) {
    super(message);
  }
}
export function retryDelay(value: string | null, now = Date.now()) {
  const seconds = value === null ? NaN : Number(value);
  const delay = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(value ?? '') - now;
  return Math.max(60_000, Number.isFinite(delay) ? delay : 60_000);
}
let readBlockedUntil = 0;
async function read<T>(
  path: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
) {
  if (Date.now() < readBlockedUntil)
    throw new MarketRequestError(
      'Request limit reached. Refresh will resume automatically.',
      readBlockedUntil - Date.now(),
    );
  const response = await fetch(`/api/v1${path}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
  });
  if (!response.ok) {
    if (response.status === 429) {
      readBlockedUntil =
        Date.now() + retryDelay(response.headers.get('Retry-After'));
      throw new MarketRequestError(
        'Request limit reached. Refresh will resume automatically.',
        readBlockedUntil - Date.now(),
      );
    }
    if (response.status === 401)
      throw new MarketRequestError(
        'Your session expired. Sign in again to load history.',
      );
    if (response.status === 404) {
      const body: unknown = await response.json().catch(() => null);
      if (
        /^\/assets\/[^/?]+(?:\/history)?(?:\?|$)/.test(path) &&
        body !== null &&
        typeof body === 'object' &&
        'error' in body &&
        body.error === 'Asset not found'
      )
        throw new MarketRequestError('Asset not found in the catalog.');
      throw new MarketRequestError(
        'Market API route is unavailable. Please try again later.',
      );
    }
    throw new MarketRequestError(
      'Market data is temporarily unavailable. Please try again.',
    );
  }
  // 202 contains the same typed history response, with refresh=pending.
  const body: unknown = await response.json().catch(() => {
    throw new MarketRequestError(
      'Market API returned an unexpected response. Please try again later.',
    );
  });
  return schema.parse(body);
}
function validateSelection(
  assets: z.infer<typeof assetSchema>[],
  quotes: z.infer<typeof quoteSchema>[],
  mode?: string,
) {
  for (const quote of quotes) {
    const asset = assets.find((value) => value.id === quote.assetId);
    const expected =
      asset?.type === 'STOCK' || mode === 'demo'
        ? 'DEMO'
        : mode === 'coinpaprika'
          ? 'COINPAPRIKA'
          : quote.provider;
    if (!asset || quote.provider !== expected)
      throw new MarketRequestError(
        'Market data mode changed. Reload to fetch matching observations.',
      );
  }
}
// Diagnostics must not hide independently validated catalog/price responses.
// A failed status read never manufactures provider configuration or observations.
async function readStatus(signal: AbortSignal) {
  try {
    return await read('/market-status', statusSchema, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
}
export async function loadOverview(signal: AbortSignal) {
  if (import.meta.env?.PROD) {
    const catalog = await read('/assets?limit=15', catalogSchema, signal);
    return {
      assets: catalog.assets,
      quotes: [] as z.infer<typeof quoteSchema>[],
      status: null,
    };
  }
  const [catalog, prices, status] = await Promise.all([
    read('/assets?limit=15', catalogSchema, signal),
    read('/quotes', quotesSchema, signal),
    readStatus(signal),
  ]);
  validateSelection(catalog.assets, prices.quotes, status?.cryptoMode);
  return {
    assets: catalog.assets,
    quotes: import.meta.env?.PROD ? [] : prices.quotes,
    status,
  };
}
export async function loadAsset(id: string, signal: AbortSignal) {
  if (import.meta.env?.PROD) {
    const detail = await read(
      `/assets/${encodeURIComponent(id)}`,
      z.object({ asset: assetSchema }),
      signal,
    );
    return { asset: detail.asset, quote: undefined, status: null };
  }
  const [detail, prices, status] = await Promise.all([
    read(
      `/assets/${encodeURIComponent(id)}`,
      z.object({ asset: assetSchema }),
      signal,
    ),
    read(`/quotes?assetIds=${encodeURIComponent(id)}`, quotesSchema, signal),
    readStatus(signal),
  ]);
  validateSelection([detail.asset], prices.quotes, status?.cryptoMode);
  return {
    asset: detail.asset,
    quote: import.meta.env?.PROD ? undefined : prices.quotes[0],
    status,
  };
}

// Keep range changes and pending polling within the API's six history reads/minute.
let nextHistoryAt = 0;
let historyQueue = Promise.resolve();
export async function loadHistory(
  id: string,
  range: HistoryRange,
  signal: AbortSignal,
  expectedProvider?: 'DEMO' | 'COINPAPRIKA',
) {
  const previous = historyQueue;
  let release!: () => void;
  historyQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    if (signal.aborted)
      throw new DOMException('Request cancelled', 'AbortError');
    const wait = Math.max(0, nextHistoryAt - Date.now());
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException('Request cancelled', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, wait);
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
    nextHistoryAt = Date.now() + 10_100;
    const history = await read(
      `/assets/${encodeURIComponent(id)}/history?range=${range}`,
      historyResponseSchema,
      signal,
    );
    if (expectedProvider && history.provider !== expectedProvider)
      throw new MarketRequestError(
        'Market data mode changed. Reload to fetch matching observations.',
      );
    return history;
  } finally {
    release();
  }
}
export const historyInterval = (data: History | null) =>
  data?.refresh === 'pending' &&
  (!data.reason || ['pending', 'busy'].includes(data.reason))
    ? 20_000
    : 60_000;
