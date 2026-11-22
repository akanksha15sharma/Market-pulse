import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';

const parsed = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    APP_ORIGIN: z.url().default('http://127.0.0.1:5173'),
    SESSION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(604800)
      .default(604800),
    CSRF_SECRET: z.string().min(64).optional(),
    EMAIL_MODE: z.enum(['disabled', 'mailpit']).default('disabled'),
    MAILPIT_URL: z.url().default('http://127.0.0.1:8025'),
  })
  .parse(process.env);
const origin = new URL(parsed.APP_ORIGIN);
if (origin.origin !== parsed.APP_ORIGIN)
  throw new Error('APP_ORIGIN must contain only an origin');
if (
  parsed.NODE_ENV === 'production' &&
  (!parsed.CSRF_SECRET || origin.protocol !== 'https:')
) {
  throw new Error(
    'Production requires HTTPS APP_ORIGIN and a stable CSRF_SECRET',
  );
}
const mailpit = new URL(parsed.MAILPIT_URL);
if (
  parsed.EMAIL_MODE === 'mailpit' &&
  (parsed.NODE_ENV === 'production' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(mailpit.hostname) ||
    mailpit.protocol !== 'http:')
) {
  throw new Error('Mailpit is a local development mail sink only');
}
export const env = {
  ...parsed,
  CSRF_SECRET: parsed.CSRF_SECRET ?? randomBytes(32).toString('hex'),
};
export type AuthConfig = {
  origin: string;
  secret: string;
  secure: boolean;
  ttlSeconds: number;
};
export const authConfig: AuthConfig = {
  origin: env.APP_ORIGIN,
  secret: env.CSRF_SECRET,
  secure: env.NODE_ENV === 'production',
  ttlSeconds: env.SESSION_TTL_SECONDS,
};
