import type { parseRuntimeEnv } from '../config/runtime-env.js';
import { HttpError } from '../lib/http-error.js';

export type AuthMail = { to: string; subject: string; text: string };
export interface AuthMailer {
  enabled: boolean;
  send(mail: AuthMail): Promise<void>;
}

type MailConfig = Pick<
  ReturnType<typeof parseRuntimeEnv>,
  'EMAIL_MODE' | 'MAILPIT_URL' | 'BREVO_API_KEY' | 'EMAIL_FROM'
>;

// Inject transport for offline tests; credentials and token-bearing bodies stay server-side.
export function createAuthMailer(
  config: MailConfig,
  transport: typeof fetch = fetch,
): AuthMailer {
  return {
    enabled: config.EMAIL_MODE !== 'disabled',
    async send(mail) {
      if (config.EMAIL_MODE === 'disabled')
        throw new HttpError(503, 'Account email is not configured');
      try {
        const brevo = config.EMAIL_MODE === 'brevo';
        const response = await transport(
          brevo
            ? 'https://api.brevo.com/v3/smtp/email'
            : new URL('/api/v1/send', config.MAILPIT_URL),
          {
            method: 'POST',
            redirect: 'error',
            headers: {
              'Content-Type': 'application/json',
              ...(brevo ? { 'api-key': config.BREVO_API_KEY! } : {}),
            },
            signal: AbortSignal.timeout(5000),
            body: JSON.stringify(
              brevo
                ? {
                    sender: { email: config.EMAIL_FROM, name: 'MarketPulse' },
                    to: [{ email: mail.to }],
                    subject: mail.subject,
                    textContent: mail.text,
                  }
                : {
                    From: {
                      Email: 'accounts@marketpulse.test',
                      Name: 'MarketPulse',
                    },
                    To: [{ Email: mail.to }],
                    Subject: mail.subject,
                    Text: mail.text,
                  },
            ),
          },
        );
        // Never expose provider bodies (which can contain personal data) or retry
        // ambiguous delivery failures: a timed-out request may already be accepted.
        if (brevo ? response.status !== 201 : !response.ok) throw new Error();
      } catch {
        throw new HttpError(503, 'Account email is temporarily unavailable');
      }
    },
  };
}
