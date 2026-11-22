import type { Prisma } from '../src/generated/prisma/client.js';
import { cryptoCatalog, stockCatalog, coinPaprikaIds } from './catalog.js';

export async function seedCatalog(db: Prisma.TransactionClient) {
  for (const [providerAssetId, symbol, name] of cryptoCatalog) {
    const key = `crypto:${providerAssetId}`;
    const data = {
      type: 'CRYPTO' as const,
      symbol,
      name,
      quoteCurrency: 'USD',
      isDemoOnly: false,
    };
    const asset = await db.asset.upsert({
      where: { key },
      create: { key, ...data },
      update: data,
    });
    for (const [provider, externalId] of [
      ['COINGECKO', providerAssetId],
      ['COINPAPRIKA', coinPaprikaIds[providerAssetId]],
      ['DEMO', key],
    ] as const) {
      await db.assetProviderMapping.upsert({
        where: { assetId_provider: { assetId: asset.id, provider } },
        create: { assetId: asset.id, provider, providerAssetId: externalId },
        update: { providerAssetId: externalId },
      });
    }
  }
  for (const [symbol, name] of stockCatalog) {
    const key = `stock:NASDAQ:${symbol}`;
    const data = {
      type: 'STOCK' as const,
      symbol,
      name,
      exchange: 'NASDAQ',
      quoteCurrency: 'USD',
      isDemoOnly: true,
    };
    const asset = await db.asset.upsert({
      where: { key },
      create: { key, ...data },
      update: data,
    });
    await db.assetProviderMapping.upsert({
      where: { assetId_provider: { assetId: asset.id, provider: 'DEMO' } },
      create: { assetId: asset.id, provider: 'DEMO', providerAssetId: key },
      update: { providerAssetId: key },
    });
  }
}
