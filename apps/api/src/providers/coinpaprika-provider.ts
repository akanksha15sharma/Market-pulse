import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import type { MarketProvider } from './market-provider.js';
import {
  ProviderFailure,
  rangeDays,
  type CatalogAsset,
  type Point,
} from '../modules/markets/types.js';
const priceSchema = z.number().finite().positive().lt(1e20);
const tickerSchema = z.object({
  id: z.string(),
  last_updated: z.string().nullable(),
  quotes: z.object({
    USD: z.object({
      price: priceSchema.nullable(),
      percent_change_24h: z
        .number()
        .finite()
        .gt(-1e10)
        .lt(1e10)
        .nullable()
        .optional(),
    }),
  }),
});
const historySchema = z
  .array(z.object({ timestamp: z.string(), price: priceSchema }))
  .max(5000);
function externalId(asset: CatalogAsset) {
  const id = asset.mappings.find(
    (mapping) => mapping.provider === 'COINPAPRIKA',
  )?.externalId;
  if (
    asset.type !== 'CRYPTO' ||
    asset.isDemoOnly ||
    !id ||
    !/^[a-z0-9]{1,20}-[a-z0-9-]{1,100}$/.test(id)
  )
    throw new ProviderFailure('invalid_data');
  return id;
}
export function retryAfter(value: string | null, now: number) {
  const seconds = value === null ? NaN : Number(value);
  const timestamp = value === null ? NaN : Date.parse(value);
  return (
    now +
    Math.max(
      60_000,
      Number.isFinite(seconds)
        ? seconds * 1000
        : Number.isFinite(timestamp)
          ? timestamp - now
          : 60_000,
    )
  );
}
export function createCoinPaprikaProvider(
  fetcher: typeof fetch = fetch,
): MarketProvider {
  async function get(
    path: string,
    query: Record<string, string>,
    now: number,
    history = false,
  ): Promise<unknown> {
    // Only these two keyless routes on the fixed free host. Never follow redirects or paid upgrades.
    if (
      path !== '/tickers' &&
      !/^\/tickers\/[a-z0-9]+-[a-z0-9-]+\/historical$/.test(path)
    )
      throw new ProviderFailure('invalid_data');
    const url = new URL(`https://api.coinpaprika.com/v1${path}`);
    url.search = new URLSearchParams(query).toString();
    const started = Date.now();
    const signal = AbortSignal.timeout(10_000);
    let response: Response;
    try {
      response = await fetcher(url, { redirect: 'error', signal });
    } catch {
      throw new ProviderFailure('network_error', true);
    }
    if (!response.ok) await response.body?.cancel().catch(() => {});
    if (response.status === 429)
      throw new ProviderFailure(
        'rate_limited',
        false,
        retryAfter(
          response.headers.get('Retry-After'),
          now + Math.max(0, Date.now() - started),
        ),
      );
    if (history && [401, 402, 403, 404].includes(response.status))
      throw new ProviderFailure('history_unavailable');
    if (response.status === 402)
      throw new ProviderFailure(
        'rate_limited',
        false,
        Math.max(
          now + 24 * 3600_000,
          retryAfter(response.headers.get('Retry-After'), now),
        ),
      );
    if ([401, 403].includes(response.status))
      throw new ProviderFailure('unauthorized');
    if (!response.ok)
      throw new ProviderFailure('upstream_error', response.status >= 500);
    try {
      if (!response.body) throw new Error('empty body');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          // The free all-tickers batch contains up to 2,000 assets; keep a hard bounded payload.
          if (size > 8 * 1024 * 1024) {
            await reader.cancel();
            throw new Error('oversized payload');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } catch (error) {
      throw new ProviderFailure(
        signal.aborted || error instanceof TypeError
          ? 'network_error'
          : 'invalid_data',
        signal.aborted || error instanceof TypeError,
      );
    }
  }
  return {
    source: 'COINPAPRIKA',
    mode: 'REAL',
    async quotes(assets, now) {
      const byId = new Map(
        assets.map((asset) => [externalId(asset), asset.id]),
      );
      const raw = z
        .array(z.unknown())
        .max(5000)
        .safeParse(await get('/tickers', { quotes: 'USD' }, now));
      if (!raw.success) throw new ProviderFailure('invalid_data');
      const seen = new Set<string>();
      const quotes = raw.data.flatMap((value) => {
        const id =
          value && typeof value === 'object' && 'id' in value
            ? value.id
            : undefined;
        if (typeof id !== 'string' || !byId.has(id)) return [];
        if (seen.has(id)) throw new ProviderFailure('invalid_data');
        seen.add(id);
        const parsed = tickerSchema.safeParse(value);
        if (!parsed.success) return [];
        const row = parsed.data;
        const timestamp = row.last_updated ? Date.parse(row.last_updated) : NaN;
        const price = row.quotes.USD.price;
        if (
          price === null ||
          !Number.isFinite(timestamp) ||
          timestamp < 0 ||
          timestamp > now + 60_000 ||
          new Prisma.Decimal(price).toFixed(18) === '0.000000000000000000'
        )
          return [];
        return [
          {
            assetId: byId.get(id)!,
            price: new Prisma.Decimal(price).toFixed(18),
            changePercent:
              row.quotes.USD.percent_change_24h == null
                ? null
                : new Prisma.Decimal(row.quotes.USD.percent_change_24h).toFixed(
                    8,
                  ),
            sourceAt: timestamp,
          },
        ];
      });
      if (!quotes.length) throw new ProviderFailure('invalid_data');
      return quotes;
    },
    async history(asset, range, now) {
      const id = externalId(asset);
      const interval = range === '1D' ? '1h' : '24h';
      const raw = await get(
        `/tickers/${id}/historical`,
        {
          start: String(
            Math.floor((now - rangeDays[range] * 86400_000) / 1000),
          ),
          end: String(Math.floor(now / 1000)),
          interval,
          quote: 'usd',
          limit: '5000',
        },
        now,
        true,
      );
      if (
        (Array.isArray(raw) && raw.length === 0) ||
        (raw &&
          typeof raw === 'object' &&
          !Array.isArray(raw) &&
          'error' in raw)
      )
        throw new ProviderFailure('history_unavailable');
      const parsed = historySchema.safeParse(raw);
      if (!parsed.success) throw new ProviderFailure('invalid_data');
      const unique = new Map<number, Point>();
      for (const row of parsed.data) {
        const timestamp = Date.parse(row.timestamp);
        if (
          !Number.isFinite(timestamp) ||
          timestamp > now + 60_000 ||
          timestamp < now - (rangeDays[range] + 1) * 86400_000
        )
          throw new ProviderFailure('invalid_data');
        const price = new Prisma.Decimal(row.price).toFixed(18);
        if (price === '0.000000000000000000')
          throw new ProviderFailure('invalid_data');
        unique.set(timestamp, { timestamp, price });
      }
      return [...unique.values()].sort((a, b) => a.timestamp - b.timestamp);
    },
  };
}
