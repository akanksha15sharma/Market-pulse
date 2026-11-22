import {
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto';
import type { Request, Response } from 'express';
import type { AuthConfig } from '../../config/env.js';
import { HttpError } from '../../lib/http-error.js';

export const newToken = () => randomBytes(32).toString('hex');
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export function constantEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
let hashing = 0;
async function derive(password: string, salt: string): Promise<Buffer> {
  if (hashing >= 2)
    throw new HttpError(503, 'Authentication is busy. Try again shortly.');
  hashing++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(
        password,
        salt,
        64,
        { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 },
        (error, result) => (error ? reject(error) : resolve(result)),
      );
    });
  } finally {
    hashing--;
  }
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$131072$8$1$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, n, r, p, salt, hash] = encoded.split('$');
  if (
    algorithm !== 'scrypt' ||
    n !== '131072' ||
    r !== '8' ||
    p !== '1' ||
    !salt ||
    !hash ||
    !/^[a-f0-9]{128}$/.test(hash)
  )
    return false;
  return constantEqual((await derive(password, salt)).toString('hex'), hash);
}
export function cookieNames(config: AuthConfig) {
  return {
    session: config.secure ? '__Host-mp_session' : 'mp_session',
    csrf: config.secure ? '__Host-mp_csrf' : 'mp_csrf',
  };
}
export function readCookie(req: Request, name: string): string | undefined {
  const matches = (req.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return undefined;
  return matches[0]!.slice(name.length + 1);
}
export function sessionToken(req: Request, config: AuthConfig) {
  const token = readCookie(req, cookieNames(config).session);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : undefined;
}
function options(config: AuthConfig) {
  return {
    httpOnly: true,
    secure: config.secure,
    sameSite: 'strict' as const,
    path: '/',
  };
}
export function writeSession(res: Response, token: string, config: AuthConfig) {
  res.cookie(cookieNames(config).session, token, {
    ...options(config),
    maxAge: config.ttlSeconds * 1000,
  });
  res.clearCookie(cookieNames(config).csrf, options(config));
}
export function clearSession(res: Response, config: AuthConfig) {
  res.clearCookie(cookieNames(config).session, options(config));
  res.clearCookie(cookieNames(config).csrf, options(config));
}
function csrfSignature(
  nonce: string,
  expires: string,
  session: string | undefined,
  config: AuthConfig,
) {
  return createHmac('sha256', config.secret)
    .update(`${nonce}.${expires}.${session ? digest(session) : 'anonymous'}`)
    .digest('hex');
}
export function issueCsrf(req: Request, res: Response, config: AuthConfig) {
  const nonce = newToken();
  const expires = String(Date.now() + 30 * 60_000);
  const token = `${nonce}.${expires}.${csrfSignature(nonce, expires, sessionToken(req, config), config)}`;
  res.cookie(cookieNames(config).csrf, token, {
    ...options(config),
    maxAge: 30 * 60_000,
  });
  return token;
}
export function requireCsrf(req: Request, config: AuthConfig) {
  const header = req.get('x-csrf-token');
  const cookie = readCookie(req, cookieNames(config).csrf);
  if (
    !header ||
    !cookie ||
    header.length > 160 ||
    !constantEqual(header, cookie)
  )
    throw new HttpError(403, 'Invalid CSRF token');
  const [nonce, expires, signature, extra] = header.split('.');
  if (
    extra ||
    !nonce ||
    !/^[a-f0-9]{64}$/.test(nonce) ||
    !expires ||
    !/^\d{13}$/.test(expires) ||
    !signature ||
    Number(expires) <= Date.now() ||
    !constantEqual(
      signature,
      csrfSignature(nonce, expires, sessionToken(req, config), config),
    )
  )
    throw new HttpError(403, 'Invalid CSRF token');
}
