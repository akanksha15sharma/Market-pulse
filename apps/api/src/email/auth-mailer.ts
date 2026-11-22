import { env } from '../config/env.js';
import { HttpError } from '../lib/http-error.js';
export type AuthMail = { to: string; subject: string; text: string };
export interface AuthMailer {
  enabled: boolean;
  send(mail: AuthMail): Promise<void>;
}
export const authMailer: AuthMailer = {
  enabled: env.EMAIL_MODE === 'mailpit',
  async send(mail) {
    if (!this.enabled)
      throw new HttpError(503, 'Account email is not configured');
    const response = await fetch(new URL('/api/v1/send', env.MAILPIT_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        From: { Email: 'accounts@marketpulse.test', Name: 'MarketPulse' },
        To: [{ Email: mail.to }],
        Subject: mail.subject,
        Text: mail.text,
      }),
    });
    if (!response.ok)
      throw new HttpError(503, 'Account email is temporarily unavailable');
  },
};
