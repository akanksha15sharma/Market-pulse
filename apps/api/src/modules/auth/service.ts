import type {
  LoginInput,
  PublicUser,
  RegisterInput,
  ResetPasswordInput,
} from '@marketpulse/contracts';
import type { PrismaClient, User } from '../../generated/prisma/client.js';
import type { AuthConfig } from '../../config/env.js';
import type { AuthMailer } from '../../email/auth-mailer.js';
import { HttpError } from '../../lib/http-error.js';
import { digest, hashPassword, newToken, verifyPassword } from './security.js';
import { createAuthRepository } from './repository.js';

const publicUser = (user: User): PublicUser => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  emailVerified: user.emailVerifiedAt !== null,
});
const invalid = () => new HttpError(401, 'Invalid email or password');
export function createAuthService(
  db: PrismaClient,
  config: AuthConfig,
  mailer: AuthMailer,
) {
  const repo = createAuthRepository(db);
  let dummy: Promise<string> | undefined;
  const dummyHash = () =>
    (dummy ??= hashPassword(newToken()).catch((error: unknown) => {
      dummy = undefined; // A temporary capacity failure must not poison later requests.
      throw error;
    }));
  const sessionExpiry = () => new Date(Date.now() + config.ttlSeconds * 1000);
  async function identity(raw: string | undefined) {
    if (!raw) throw new HttpError(401, 'Sign in to continue');
    const session = await repo.findSession(digest(raw));
    if (!session || session.revokedAt || session.expiresAt <= new Date())
      throw new HttpError(401, 'Session expired. Sign in again.');
    return session;
  }
  async function deliver(
    user: User,
    purpose: 'VERIFY_EMAIL' | 'RESET_PASSWORD',
  ) {
    if (!mailer.enabled)
      throw new HttpError(503, 'Account email is not configured');
    const token = newToken();
    const record = await repo.createToken({
      userId: user.id,
      purpose,
      tokenHash: digest(token),
      expiresAt: new Date(
        Date.now() +
          (purpose === 'RESET_PASSWORD' ? 30 * 60_000 : 24 * 60 * 60_000),
      ),
    });
    const path =
      purpose === 'RESET_PASSWORD' ? '/reset-password' : '/verify-email';
    try {
      await mailer.send({
        to: user.email,
        subject:
          purpose === 'RESET_PASSWORD'
            ? 'Reset your MarketPulse password'
            : 'Verify your MarketPulse email',
        text: `Open ${config.origin}${path}#token=${token} to continue. This link can be used once. If you did not request it, ignore this email.`,
      });
    } catch {
      await repo.deleteToken(record.id);
      throw new HttpError(503, 'Account email is temporarily unavailable');
    }
  }
  return {
    async limit(key: string, max: number, windowMs: number) {
      if ((await repo.incrementLimit(key, windowMs)) > max)
        throw new HttpError(429, 'Too many attempts. Try again later.');
    },
    async register(input: RegisterInput, old: string | undefined) {
      const passwordHash = await hashPassword(input.password);
      const token = newToken();
      try {
        const user = await repo.register(
          { email: input.email, displayName: input.displayName, passwordHash },
          digest(token),
          sessionExpiry(),
          old ? digest(old) : undefined,
        );
        // Explicit resend avoids disguising a successful signup as a mail failure.
        return { user: publicUser(user), token };
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'P2002'
        )
          throw new HttpError(
            409,
            'Unable to register with these details. Try signing in.',
          );
        throw error;
      }
    },
    async login(input: LoginInput, old: string | undefined) {
      const snapshot = await repo.findUser(input.email);
      const encoded = snapshot?.passwordHash ?? (await dummyHash());
      if (!(await verifyPassword(input.password, encoded)) || !snapshot)
        throw invalid();
      const token = newToken();
      const user = await repo.login(
        snapshot,
        digest(token),
        sessionExpiry(),
        old ? digest(old) : undefined,
      );
      if (!user) throw invalid();
      return { user: publicUser(user), token };
    },
    async me(raw: string | undefined) {
      return publicUser((await identity(raw)).user);
    },
    async logout(raw: string | undefined) {
      if (raw) await repo.logout(digest(raw));
    },
    async sessions(raw: string | undefined) {
      const current = await identity(raw);
      const sessions = await repo.sessions(current.userId);
      return sessions.map((session) => ({
        ...session,
        current: session.id === current.id,
      }));
    },
    async revoke(raw: string | undefined, id: string) {
      const current = await identity(raw);
      const result = await repo.revoke(current.userId, id);
      if (!result.count) throw new HttpError(404, 'Session not found');
      return id === current.id;
    },
    async requestReset(email: string) {
      if (!mailer.enabled)
        throw new HttpError(503, 'Account email is not configured');
      const user = await repo.findUser(email);
      if (user) {
        try {
          await deliver(user, 'RESET_PASSWORD');
        } catch {
          /* Same public outcome for existing/unknown accounts. */
        }
      }
    },
    async resend(raw: string | undefined) {
      const current = await identity(raw);
      if (!current.user.emailVerifiedAt)
        await deliver(current.user, 'VERIFY_EMAIL');
    },
    async verify(token: string) {
      if (!(await repo.verify(digest(token))))
        throw new HttpError(400, 'Invalid or expired verification link');
    },
    async reset(input: ResetPasswordInput) {
      const snapshot = await repo.findToken(digest(input.token));
      if (
        !snapshot ||
        snapshot.purpose !== 'RESET_PASSWORD' ||
        snapshot.consumedAt ||
        snapshot.expiresAt <= new Date()
      )
        throw new HttpError(400, 'Invalid or expired reset link');
      const passwordHash = await hashPassword(input.password);
      if (!(await repo.reset(snapshot.userId, snapshot.id, passwordHash)))
        throw new HttpError(400, 'Invalid or expired reset link');
    },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
