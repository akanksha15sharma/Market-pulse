import type {
  Prisma,
  PrismaClient,
  User,
} from '../../generated/prisma/client.js';

export function createAuthRepository(db: PrismaClient) {
  async function insertSession(
    tx: Prisma.TransactionClient,
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    oldHash?: string,
  ) {
    if (oldHash)
      await tx.session.updateMany({
        where: { tokenHash: oldHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    const active = await tx.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (active.length >= 10)
      await tx.session.updateMany({
        where: { id: { in: active.slice(9).map((row) => row.id) } },
        data: { revokedAt: new Date() },
      });
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
      return db.$transaction(async (tx) => {
        const user = await tx.user.create({ data });
        await insertSession(tx, user.id, tokenHash, expiresAt, oldHash);
        return user;
      });
    },
    login(
      snapshot: User,
      tokenHash: string,
      expiresAt: Date,
      oldHash?: string,
    ) {
      return db.$transaction(async (tx) => {
        // Serialize session issuance against password reset; reject a changed hash.
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${snapshot.id}::uuid FOR UPDATE`;
        const user = await tx.user.findUnique({ where: { id: snapshot.id } });
        if (!user || user.passwordHash !== snapshot.passwordHash) return null;
        await insertSession(tx, user.id, tokenHash, expiresAt, oldHash);
        return user;
      });
    },
    logout: (tokenHash: string) =>
      db.session.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    sessions: (userId: string) =>
      db.session.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, expiresAt: true },
      }),
    revoke: (userId: string, id: string) =>
      db.session.updateMany({
        where: { id, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
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
      return db.$transaction(async (tx) => {
        const record = await tx.authToken.findUnique({ where: { tokenHash } });
        if (!record || record.purpose !== 'VERIFY_EMAIL') return false;
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${record.userId}::uuid FOR UPDATE`;
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
        return true;
      });
    },
    reset(userId: string, id: string, passwordHash: string) {
      return db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
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
        await tx.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.authToken.updateMany({
          where: { userId, purpose: 'RESET_PASSWORD', consumedAt: null },
          data: { consumedAt: new Date() },
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
