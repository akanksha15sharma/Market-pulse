import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { PoolConfig } from 'pg';

export function createDatabaseClient(
  connectionString = process.env.DATABASE_URL,
  options: Pick<
    PoolConfig,
    'max' | 'connectionTimeoutMillis' | 'query_timeout'
  > = {},
) {
  if (!connectionString)
    throw new Error('DATABASE_URL is required for database operations');
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 5000,
      query_timeout: 10_000,
      ...options,
    }),
  });
}

let shared: PrismaClient | undefined;
export function getDatabaseClient() {
  return (shared ??= createDatabaseClient());
}
export async function disconnectDatabase() {
  await shared?.$disconnect();
  shared = undefined;
}
