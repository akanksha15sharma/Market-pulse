import { Prisma } from '../generated/prisma/client.js';
import type { MarketProvider } from './market-provider.js';
import {
  granularity,
  rangeDays,
  type CatalogAsset,
} from '../modules/markets/types.js';
import type { HistoryRange } from '@marketpulse/contracts';

function seed(key: string) {
  return [...key].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) >>> 0, 7);
}
function price(asset: CatalogAsset, timestamp: number) {
  const base = 10_000 + (seed(asset.key) % 90_000);
  const wave = Math.round(
    (Math.sin(Math.floor(timestamp / 60_000) / 37 + (seed(asset.key) % 100)) *
      base) /
      25,
  );
  return new Prisma.Decimal(base + wave).div(100).toFixed(18);
}
export const demoProvider: MarketProvider = {
  source: 'DEMO',
  mode: 'DEMO',
  async quotes(assets, now) {
    const sourceAt = Math.floor(now / 60_000) * 60_000;
    return assets.map((asset) => {
      const current = price(asset, sourceAt);
      const previous = price(asset, sourceAt - 86400_000);
      return {
        assetId: asset.id,
        price: current,
        changePercent: new Prisma.Decimal(current)
          .div(previous)
          .minus(1)
          .mul(100)
          .toFixed(8),
        sourceAt,
      };
    });
  },
  async history(asset, range: HistoryRange, now) {
    const step =
      granularity(range) === '5m'
        ? 300_000
        : granularity(range) === '1h'
          ? 3600_000
          : 86400_000;
    const end = Math.floor(now / step) * step;
    const start = end - rangeDays[range] * 86400_000;
    return Array.from(
      { length: Math.floor((end - start) / step) + 1 },
      (_, index) => {
        const timestamp = start + index * step;
        return { timestamp, price: price(asset, timestamp) };
      },
    );
  },
};
