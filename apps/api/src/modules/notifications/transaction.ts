import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http-error.js';

// Inbox writers, preferences and genuine event producers share the account lock.
// Lock all participating accounts in sorted order before multi-account writes.
export async function lockNotificationUser(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  if (!rows.length) throw new HttpError(401, 'Sign in to continue');
}
export const notificationTransactionOptions = {
  isolationLevel: 'ReadCommitted',
  maxWait: 10_000,
  timeout: 20_000,
} as const;

export function notificationTransaction<T>(
  db: PrismaClient,
  userId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return db.$transaction(async (tx) => {
    await lockNotificationUser(tx, userId);
    return operation(tx);
  }, notificationTransactionOptions);
}
