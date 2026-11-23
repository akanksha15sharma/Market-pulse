import type { MarketSettings } from '../../config/markets.js';
import { createDatabaseClient } from '../../db/client.js';
import { createDatabaseMarketEngine } from './engine-factory.js';

type BatchConnection = {
  tick: () => Promise<void>;
  disconnect: () => Promise<void>;
};

// A scheduler performs actual ingestion directly, without waking the web service.
// Reuse the same persisted leases, quotas, alert evaluation, and chart queue.
export async function runMarketOnce(
  settings: MarketSettings,
  connect: () => BatchConnection = () => {
    const db = createDatabaseClient();
    const { engine } = createDatabaseMarketEngine(db, settings);
    return { tick: engine.tick, disconnect: () => db.$disconnect() };
  },
) {
  if (!settings.MARKET_WORKER_ENABLED)
    throw new Error('A market batch requires MARKET_WORKER_ENABLED=true');
  const connection = connect();
  try {
    await connection.tick();
  } finally {
    await connection.disconnect();
  }
}
