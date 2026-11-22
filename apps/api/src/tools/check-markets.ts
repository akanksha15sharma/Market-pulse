import { marketSettings } from '../config/markets.js';
import { createDatabaseClient } from '../db/client.js';
import { createMarketRepository } from '../modules/markets/repository.js';
import { createMarketService } from '../modules/markets/service.js';
import { budgetWindows } from '../modules/markets/engine.js';
import { MarketDeferred } from '../modules/markets/types.js';

// Read-only preflight: no provider request, worker activation, reservation or reset.
async function check() {
  if (marketSettings.CRYPTO_DATA_MODE !== 'coinpaprika') {
    console.error(
      'Crypto is in demo mode. See docs/live-crypto.md to select CoinPaprika.',
    );
    process.exitCode = 1;
    return;
  }
  try {
    budgetWindows(marketSettings, Date.now(), 'quotes');
  } catch (error) {
    console.error(
      `CoinPaprika is not ready: ${error instanceof MarketDeferred ? error.reason : 'invalid_configuration'}. See docs/live-crypto.md.`,
    );
    process.exitCode = 1;
    return;
  }
  if (!marketSettings.MARKET_WORKER_ENABLED) {
    console.error(
      'The market worker is disabled. Enable it for live ingestion.',
    );
    process.exitCode = 1;
    return;
  }
  const db = createDatabaseClient();
  try {
    const status = await createMarketService(
      createMarketRepository(db),
      marketSettings,
    ).status();
    // This public DTO contains operational status, never credentials or URLs.
    console.log(JSON.stringify(status, null, 2));
    const provider = status.providers.find(
      (row) => row.provider === 'COINPAPRIKA',
    );
    if (provider?.quoteReason || provider?.historyReason) process.exitCode = 1;
    else
      console.log(
        'Local configuration and persisted budgets are ready. No live request was made.',
      );
  } finally {
    await db.$disconnect();
  }
}
void check().catch(() => {
  console.error(
    'Could not inspect provider budgets. Check server database configuration and existing migrations.',
  );
  process.exitCode = 1;
});
