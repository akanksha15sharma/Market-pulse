import { createDatabaseClient } from '../src/db/client.js';
import { seedCatalog } from './seed-catalog.js';

const db = createDatabaseClient();
try {
  await db.$transaction(seedCatalog, { timeout: 30_000 });
  console.log(
    'Catalog seeded: 10 cryptocurrencies and 5 demo-only stocks; no market prices or users.',
  );
} finally {
  await db.$disconnect();
}
