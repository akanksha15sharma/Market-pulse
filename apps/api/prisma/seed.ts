import { createDatabaseClient } from '../src/db/client.js';
import { runCatalogSeed, seedConnectionOptions } from './seed-runner.js';

const db = createDatabaseClient(
  process.env.DATABASE_URL,
  seedConnectionOptions,
);
await runCatalogSeed(db);
console.log(
  'Catalog seeded: 10 cryptocurrencies and 5 demo-only stocks; no market prices or users.',
);
