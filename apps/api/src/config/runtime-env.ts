import { isIP } from 'node:net';
import { z } from 'zod';

function validProxy(value: string) {
  const [address, prefix, extra] = value.split('/');
  const version = isIP(address ?? '');
  return (
    !!version &&
    extra === undefined &&
    (prefix === undefined ||
      (/^\d+$/.test(prefix) &&
        Number(prefix) > 0 &&
        Number(prefix) <= (version === 4 ? 32 : 128)))
  );
}

// Pure validation keeps configuration tests independent of secrets in process.env.
export function parseRuntimeEnv(input: Record<string, string | undefined>) {
  const parsed = z
    .object({
      NODE_ENV: z
        .enum(['development', 'test', 'production'])
        .default('development'),
      HOST: z.string().default('127.0.0.1'),
      PORT: z.coerce.number().int().min(1).max(65535).default(3001),
      TRUSTED_PROXIES: z
        .string()
        .default('')
        .transform((value) =>
          value
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean),
        )
        .pipe(
          z.array(
            z
              .string()
              .refine(
                validProxy,
                'Use explicit proxy IP addresses or CIDRs with a nonzero prefix',
              ),
          ),
        ),
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
    .parse(input);
  const origin = new URL(parsed.APP_ORIGIN);
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.origin !== parsed.APP_ORIGIN
  )
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

  return parsed;
}
