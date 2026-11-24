import type { PrismaClient } from '../src/generated/prisma/client.js';
import { seedCatalog } from './seed-catalog.js';

// Release tooling can tolerate cold compute and WAN latency; API defaults stay short.
export const seedConnectionOptions = {
  max: 1,
  connectionTimeoutMillis: 30_000,
  query_timeout: 30_000,
};

type SeedClient = Pick<
  PrismaClient,
  '$queryRaw' | '$transaction' | '$disconnect'
>;

export async function runCatalogSeed(db: SeedClient) {
  try {
    // Establish a working connection before starting the atomic write transaction.
    await db.$queryRaw`SELECT 1`;
    await db.$transaction(seedCatalog, { maxWait: 60_000, timeout: 120_000 });
  } finally {
    await db.$disconnect();
  }
}
