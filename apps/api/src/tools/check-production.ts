import 'dotenv/config';
import { validateProductionEnv } from '../config/runtime-env.js';

try {
  validateProductionEnv(process.env);
  // Import inside the guard so invalid market settings also produce a safe error.
  await import('../config/markets.js');
  console.log(
    'Production configuration is valid. No database connection, migration, provider request, or deployment was performed.',
  );
} catch {
  console.error(
    'Production configuration is invalid. Check NODE_ENV, APP_ORIGIN, CSRF_SECRET, DATABASE_URL, DIRECT_DATABASE_URL, TRUSTED_PROXIES, EMAIL_MODE, and market settings. Values are omitted to protect secrets.',
  );
  process.exitCode = 1;
}
