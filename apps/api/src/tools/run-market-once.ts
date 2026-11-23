import { marketSettings } from '../config/markets.js';
import { runMarketOnce } from '../modules/markets/run-once.js';

try {
  await runMarketOnce(marketSettings);
  console.log(
    'One market batch completed. Provider availability, persisted quotas, and alert eligibility still apply.',
  );
} catch {
  console.error(
    'Market batch failed. Check worker configuration and database connectivity. Connection details are omitted to protect credentials.',
  );
  process.exitCode = 1;
}
