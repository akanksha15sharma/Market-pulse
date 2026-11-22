import { z } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import type { MarketProvider } from './market-provider.js';
import {
  ProviderFailure,
  rangeDays,
  type CatalogAsset,
  type Point,
} from '../modules/markets/types.js';

const recordSchema = z.object({
  id: z.string(),
  current_price: z.number().finite().positive().lt(1e20).nullable(),
  price_change_percentage_24h: z
    .number()
    .finite()
    .gt(-1e10)
    .lt(1e10)
    .nullable()
    .optional(),
  last_updated: z.string().nullable(),
});
const historySchema = z.object({
  prices: z
    .array(
      z.tuple([
        z.number().int().nonnegative(),
        z.number().finite().positive().lt(1e20),
      ]),
    )
    .min(1)
    .max(5000),
});
function externalId(asset: CatalogAsset) {
  const id = asset.mappings.find(
    (mapping) => mapping.provider === 'COINGECKO',
  )?.externalId;
  if (!id || !/^[a-z0-9-]{1,100}$/.test(id))
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
export function createCoinGeckoProvider(
  key: string,
  fetcher: typeof fetch = fetch,
): MarketProvider {
  async function get(
    path: string,
    query: Record<string, string>,
    now: number,
  ): Promise<unknown> {
    // Fixed allowlisted origin, no arbitrary upstream URLs or redirects.
    const url = new URL(`https://api.coingecko.com/api/v3${path}`);
    url.search = new URLSearchParams(query).toString();
    const started = Date.now();
    const signal = AbortSignal.timeout(10_000);
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { 'x-cg-demo-api-key': key },
        redirect: 'error',
        signal,
      });
    } catch {
      throw new ProviderFailure('network_error', true);
    }
    if (!response.ok) await response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403)
      throw new ProviderFailure('unauthorized');
    if (response.status === 429)
      throw new ProviderFailure(
        'rate_limited',
        false,
        retryAfter(
          response.headers.get('Retry-After'),
          now + Math.max(0, Date.now() - started),
        ),
      );
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
          if (size > 2 * 1024 * 1024) {
            await reader.cancel();
            throw new Error('response too large');
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
    source: 'COINGECKO',
    mode: 'REAL',
    async quotes(assets, now) {
      const byId = new Map(
        assets.map((asset) => [externalId(asset), asset.id]),
      );
      const parsed = z
        .array(recordSchema)
        .max(250)
        .safeParse(
          await get(
            '/coins/markets',
            {
              vs_currency: 'usd',
              ids: [...byId.keys()].join(','),
              per_page: '250',
              sparkline: 'false',
              precision: 'full',
            },
            now,
          ),
        );
      if (!parsed.success) throw new ProviderFailure('invalid_data');
      const seen = new Set<string>();
      const quotes = parsed.data.flatMap((row) => {
        if (seen.has(row.id)) throw new ProviderFailure('invalid_data');
        seen.add(row.id);
        const assetId = byId.get(row.id);
        const timestamp = row.last_updated ? Date.parse(row.last_updated) : NaN;
        if (
          !assetId ||
          row.current_price === null ||
          new Prisma.Decimal(row.current_price).toFixed(18) ===
            '0.000000000000000000' ||
          !Number.isFinite(timestamp) ||
          timestamp > now + 60_000
        )
          return [];
        return [
          {
            assetId,
            price: new Prisma.Decimal(row.current_price).toFixed(18),
            changePercent:
              row.price_change_percentage_24h == null
                ? null
                : new Prisma.Decimal(row.price_change_percentage_24h).toFixed(
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
      const parsed = historySchema.safeParse(
        await get(
          `/coins/${encodeURIComponent(externalId(asset))}/market_chart`,
          {
            vs_currency: 'usd',
            days: String(rangeDays[range]),
            precision: 'full',
          },
          now,
        ),
      );
      if (!parsed.success) throw new ProviderFailure('invalid_data');
      const unique = new Map<number, Point>();
      for (const [timestamp, price] of parsed.data.prices) {
        if (
          timestamp > now + 60_000 ||
          timestamp < now - (rangeDays[range] + 1) * 86400_000
        )
          throw new ProviderFailure('invalid_data');
        const normalized = new Prisma.Decimal(price).toFixed(18);
        if (normalized === '0.000000000000000000')
          throw new ProviderFailure('invalid_data');
        unique.set(timestamp, { timestamp, price: normalized });
      }
      return [...unique.values()].sort((a, b) => a.timestamp - b.timestamp);
    },
  };
}
