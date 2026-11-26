import { randomUUID } from 'node:crypto';
import type {
  Prisma,
  PrismaClient,
  User,
} from '../../generated/prisma/client.js';
import { recordNotification } from '../notifications/producer.js';
import {
  notificationTransaction,
  notificationTransactionOptions,
} from '../notifications/transaction.js';

export function createAuthRepository(db: PrismaClient) {
  // A login can replace a cookie belonging to another account. Lock both owners
  // in stable order before changing sessions to avoid opposite-login deadlocks.
  async function lockSessionOwners(
    tx: Prisma.TransactionClient,
    userId: string,
    oldHash?: string,
  ) {
    const old = oldHash
      ? await tx.session.findUnique({
          where: { tokenHash: oldHash },
          select: { userId: true },
        })
      : null;
    for (const id of [
      ...new Set([userId, ...(old ? [old.userId] : [])]),
    ].sort())
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`;
  }
  async function revokeSessions(
    tx: Prisma.TransactionClient,
    where: Prisma.SessionWhereInput,
    operationId: string,
  ) {
    const now = new Date();
    const active = await tx.session.findMany({
      where: { AND: [where, { revokedAt: null, expiresAt: { gt: now } }] },
      select: { userId: true },
    });
    const result = await tx.session.updateMany({
      where,
      data: { revokedAt: now },
    });
    for (const userId of new Set(active.map((row) => row.userId)))
      await recordNotification(tx, {
        userId,
        kind: 'SESSION_REVOKED',
        operationId,
      });
    return result;
  }
  async function insertSession(
    tx: Prisma.TransactionClient,
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    operationId: string,
    oldHash?: string,
  ) {
    if (oldHash)
      await revokeSessions(
        tx,
        { tokenHash: oldHash, revokedAt: null },
        operationId,
      );
    const active = await tx.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    if (active.length >= 10)
      await revokeSessions(
        tx,
        { id: { in: active.slice(9).map((row) => row.id) }, revokedAt: null },
        operationId,
      );
    await tx.session.create({ data: { userId, tokenHash, expiresAt } });
  }
  return {
    findUser: (email: string) => db.user.findUnique({ where: { email } }),
    findSession: (tokenHash: string) =>
      db.session.findUnique({ where: { tokenHash }, include: { user: true } }),
    register(
      data: { email: string; displayName: string; passwordHash: string },
      tokenHash: string,
      expiresAt: Date,
      oldHash?: string,
    ) {
      const operationId = randomUUID();
      return db.$transaction(async (tx) => {
        const user = await tx.user.create({ data });
        // This new, uncommitted user cannot yet be locked by another transaction.
        await lockSessionOwners(tx, user.id, oldHash);
        await insertSession(
          tx,
          user.id,
          tokenHash,
          expiresAt,
          operationId,
          oldHash,
        );
        await recordNotification(tx, {
          userId: user.id,
          kind: 'ACCOUNT_CREATED',
          operationId,
        });
        return user;
      }, notificationTransactionOptions);
    },
    login(
      snapshot: User,
      tokenHash: string,
      expiresAt: Date,
      oldHash?: string,
    ) {
      const operationId = randomUUID();
      return db.$transaction(async (tx) => {
        await lockSessionOwners(tx, snapshot.id, oldHash);
        const user = await tx.user.findUnique({ where: { id: snapshot.id } });
        if (!user || user.passwordHash !== snapshot.passwordHash) return null;
        await insertSession(
          tx,
          user.id,
          tokenHash,
          expiresAt,
          operationId,
          oldHash,
        );
        await recordNotification(tx, {
          userId: user.id,
          kind: 'SIGNED_IN',
          operationId,
        });
        return user;
      }, notificationTransactionOptions);
    },
    async logout(tokenHash: string) {
      const operationId = randomUUID();
      const session = await db.session.findUnique({
        where: { tokenHash },
        select: { userId: true },
      });
      if (!session) return { count: 0 };
      return notificationTransaction(db, session.userId, (tx) =>
        revokeSessions(
          tx,
          { tokenHash, userId: session.userId, revokedAt: null },
          operationId,
        ),
      );
    },
    sessions: (userId: string) =>
      db.session.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, expiresAt: true },
      }),
    revoke(userId: string, id: string) {
      const operationId = randomUUID();
      return notificationTransaction(db, userId, (tx) =>
        revokeSessions(tx, { id, userId, revokedAt: null }, operationId),
      );
    },
    createToken: (data: {
      userId: string;
      purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD';
      tokenHash: string;
      expiresAt: Date;
    }) => db.authToken.create({ data }),
    deleteToken: (id: string) => db.authToken.delete({ where: { id } }),
    findToken: (tokenHash: string) =>
      db.authToken.findUnique({ where: { tokenHash } }),
    verify(tokenHash: string) {
      const operationId = randomUUID();
      return db.$transaction(async (tx) => {
        const record = await tx.authToken.findUnique({ where: { tokenHash } });
        if (!record || record.purpose !== 'VERIFY_EMAIL') return false;
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${record.userId}::uuid FOR UPDATE`;
        const user = await tx.user.findUnique({ where: { id: record.userId } });
        if (!user || user.emailVerifiedAt !== null) return false;
        const consumed = await tx.authToken.updateMany({
          where: {
            id: record.id,
            consumedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { consumedAt: new Date() },
        });
        if (!consumed.count) return false;
        await tx.user.update({
          where: { id: record.userId },
          data: { emailVerifiedAt: new Date() },
        });
        await tx.authToken.updateMany({
          where: {
            userId: record.userId,
            purpose: 'VERIFY_EMAIL',
            consumedAt: null,
          },
          data: { consumedAt: new Date() },
        });
        await recordNotification(tx, {
          userId: record.userId,
          kind: 'EMAIL_VERIFIED',
          operationId,
        });
        return true;
      }, notificationTransactionOptions);
    },
    reset(userId: string, id: string, passwordHash: string) {
      const operationId = randomUUID();
      return notificationTransaction(db, userId, async (tx) => {
        const consumed = await tx.authToken.updateMany({
          where: {
            id,
            userId,
            purpose: 'RESET_PASSWORD',
            consumedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { consumedAt: new Date() },
        });
        if (!consumed.count) return false;
        await tx.user.update({ where: { id: userId }, data: { passwordHash } });
        await revokeSessions(tx, { userId, revokedAt: null }, operationId);
        await tx.authToken.updateMany({
          where: { userId, purpose: 'RESET_PASSWORD', consumedAt: null },
          data: { consumedAt: new Date() },
        });
        await recordNotification(tx, {
          userId,
          kind: 'PASSWORD_RESET',
          operationId,
        });
        return true;
      });
    },
    async incrementLimit(key: string, windowMs: number) {
      const start = new Date(Math.floor(Date.now() / windowMs) * windowMs);
      const expiresAt = new Date(start.getTime() + windowMs);
      const result = await db.$queryRaw<
        { count: number }[]
      >`INSERT INTO auth_rate_limits (key, "windowStart", "expiresAt", count) VALUES (${key}, ${start}, ${expiresAt}, 1) ON CONFLICT (key, "windowStart") DO UPDATE SET count = auth_rate_limits.count + 1 RETURNING count`;
      return result[0]?.count ?? Number.MAX_SAFE_INTEGER;
    },
  };
}
