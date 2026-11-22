import { marketSettings } from './config/markets.js';
import { createDatabaseClient } from './db/client.js';
import { createMarketRuntime } from './modules/markets/runtime.js';

if (!marketSettings.MARKET_ALWAYS_ON || !marketSettings.MARKET_WORKER_ENABLED)
  throw new Error(
    'Standalone worker requires explicit MARKET_ALWAYS_ON=true and MARKET_WORKER_ENABLED=true',
  );
const db = createDatabaseClient();
const runtime = createMarketRuntime(db);
runtime.start();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void runtime
      .stop()
      .then(() => db.$disconnect())
      .catch(() => {
        process.exitCode = 1;
      });
  });
