import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { parseRuntimeEnv } from './runtime-env.js';

const parsed = parseRuntimeEnv(process.env);
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
