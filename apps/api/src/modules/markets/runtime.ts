import type { PrismaClient } from '../../generated/prisma/client.js';
import { marketSettings, type MarketSettings } from '../../config/markets.js';
import { demoProvider } from '../../providers/demo-provider.js';
import { createCoinPaprikaProvider } from '../../providers/coinpaprika-provider.js';
import type { MarketProvider } from '../../providers/market-provider.js';
import { createMarketRepository } from './repository.js';
import { createMarketEngine } from './engine.js';
import { createMarketService } from './service.js';
import type { Source } from './types.js';

export function createMarketRuntime(
  db: PrismaClient,
  settings: MarketSettings = marketSettings,
) {
  const store = createMarketRepository(db);
  const providers = new Map<Source, MarketProvider>([['DEMO', demoProvider]]);
  if (settings.CRYPTO_DATA_MODE === 'coinpaprika')
    providers.set('COINPAPRIKA', createCoinPaprikaProvider());
  const engine = createMarketEngine(store, providers, settings);
  let activeUntil = 0;
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  let stopped = false;
  const run = () => {
    if (
      stopped ||
      running ||
      (!settings.MARKET_ALWAYS_ON && Date.now() > activeUntil)
    )
      return;
    running = engine
      .tick()
      .catch(() => {
        console.error('Market worker failed; persisted jobs remain queued.');
      })
      .finally(() => {
        running = undefined;
      });
  };
  function activate() {
    if (!settings.MARKET_WORKER_ENABLED || stopped) return;
    activeUntil = Date.now() + 10 * 60_000;
    if (!timer) {
      timer = setInterval(() => {
        if (!settings.MARKET_ALWAYS_ON && Date.now() > activeUntil) {
          clearInterval(timer);
          timer = undefined;
          return;
        }
        run();
      }, 15_000);
      if (!settings.MARKET_ALWAYS_ON) timer.unref();
      run();
    }
  }
  return {
    service: createMarketService(store, settings, activate),
    start: activate,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
