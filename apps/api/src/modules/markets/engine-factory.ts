import type { PrismaClient } from '../../generated/prisma/client.js';
import {
  nativeMarketsAllowed,
  type MarketSettings,
} from '../../config/markets.js';
import { demoProvider } from '../../providers/demo-provider.js';
import { createCoinPaprikaProvider } from '../../providers/coinpaprika-provider.js';
import type { MarketProvider } from '../../providers/market-provider.js';
import { createMarketRepository } from './repository.js';
import { createMarketEngine } from './engine.js';
import type { Source } from './types.js';

export function createDatabaseMarketEngine(
  db: PrismaClient,
  settings: MarketSettings,
) {
  const store = createMarketRepository(db);
  const providers = new Map<Source, MarketProvider>();
  if (nativeMarketsAllowed(settings)) providers.set('DEMO', demoProvider);
  if (
    nativeMarketsAllowed(settings) &&
    settings.CRYPTO_DATA_MODE === 'coinpaprika'
  )
    providers.set('COINPAPRIKA', createCoinPaprikaProvider());
  return { store, engine: createMarketEngine(store, providers, settings) };
}
