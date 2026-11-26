import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { HttpError } from '../../lib/http-error.js';

// All inbox/preference writers share the account lock. Future producers must use
// this helper in the same transaction as the real activity; E2 adds no producers.
export async function lockNotificationUser(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
  if (!rows.length) throw new HttpError(401, 'Sign in to continue');
}
export function notificationTransaction<T>(
  db: PrismaClient,
  userId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return db.$transaction(
    async (tx) => {
      await lockNotificationUser(tx, userId);
      return operation(tx);
    },
    { isolationLevel: 'ReadCommitted', maxWait: 10_000, timeout: 20_000 },
  );
}
