import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuthMailer } from '../../src/email/delivery.js';
import { parseRuntimeEnv } from '../../src/config/runtime-env.js';
import { HttpError } from '../../src/lib/http-error.js';

const config = parseRuntimeEnv({
  EMAIL_MODE: 'brevo',
  EMAIL_FROM: 'sender@gmail.com',
  BREVO_API_KEY: 'test-key-only',
});
const mail = {
  to: 'recipient@gmail.com',
  subject: 'Verify your MarketPulse email',
  text: 'Open https://marketpulse.example/verify-email#token=private-token',
};

test('Brevo sends verification and reset text through fixed HTTPS endpoint', async () => {
  for (const subject of [mail.subject, 'Reset your MarketPulse password']) {
    let calls = 0;
    const mailer = createAuthMailer(config, async (url, init) => {
      calls++;
      assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.redirect, 'error');
      assert.deepEqual(init?.headers, {
        'Content-Type': 'application/json',
        'api-key': 'test-key-only',
      });
      assert.ok(init?.signal instanceof AbortSignal);
      assert.deepEqual(JSON.parse(init?.body as string), {
        sender: { email: 'sender@gmail.com', name: 'MarketPulse' },
        to: [{ email: mail.to }],
        subject,
        textContent: mail.text,
      });
      return new Response('{}', { status: 201 });
    });
    assert.equal(mailer.enabled, true);
    await mailer.send({ ...mail, subject });
    assert.equal(calls, 1);
  }
});

test('provider failures, quota exhaustion, network errors and timeouts are sanitized without retries', async () => {
  for (const failure of [400, 401, 403, 429, 500, 200, 'network', 'timeout']) {
    let calls = 0;
    const mailer = createAuthMailer(config, async () => {
      calls++;
      if (typeof failure === 'string')
        throw new Error(
          `${failure}: test-key-only private-token recipient@gmail.com`,
        );
      return new Response('test-key-only private-token recipient@gmail.com', {
        status: failure,
      });
    });
    await assert.rejects(
      () => mailer.send(mail),
      (error: unknown) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.status, 503);
        assert.equal(error.message, 'Account email is temporarily unavailable');
        assert.equal(error.cause, undefined);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

test('Mailpit remains local with its original payload and no Brevo credential', async () => {
  const mailer = createAuthMailer(
    parseRuntimeEnv({ EMAIL_MODE: 'mailpit' }),
    async (url, init) => {
      assert.equal(String(url), 'http://127.0.0.1:8025/api/v1/send');
      assert.deepEqual(init?.headers, { 'Content-Type': 'application/json' });
      assert.deepEqual(JSON.parse(init?.body as string), {
        From: { Email: 'accounts@marketpulse.test', Name: 'MarketPulse' },
        To: [{ Email: mail.to }],
        Subject: mail.subject,
        Text: mail.text,
      });
      return new Response('{}');
    },
  );
  await mailer.send(mail);
});

test('disabled email makes no outbound requests', async () => {
  const mailer = createAuthMailer(parseRuntimeEnv({}), async () => {
    assert.fail('must not send');
  });
  assert.equal(mailer.enabled, false);
  await assert.rejects(() => mailer.send(mail), /not configured/);
});

test('Brevo requires a nonempty key and valid sender, including production', () => {
  const production = {
    NODE_ENV: 'production',
    APP_ORIGIN: 'https://marketpulse.example',
    CSRF_SECRET: 'a'.repeat(64),
    EMAIL_MODE: 'brevo',
    BREVO_API_KEY: 'test-key-only',
    EMAIL_FROM: 'sender@gmail.com',
  };
  assert.equal(parseRuntimeEnv(production).EMAIL_MODE, 'brevo');
  for (const overrides of [
    { BREVO_API_KEY: undefined },
    { BREVO_API_KEY: ' ' },
    { EMAIL_FROM: undefined },
    { EMAIL_FROM: 'bad address' },
  ])
    assert.throws(() => parseRuntimeEnv({ ...production, ...overrides }));
});

test('existing verification/reset flows clean failed tokens and preserve reset privacy', async () => {
  const { createAuthService } =
    await import('../../src/modules/auth/service.js');
  let exists = true;
  const deleted: string[] = [];
  const created: { purpose: string; tokenHash: string; expiresAt: Date }[] = [];
  const user = { id: 'user-id', email: mail.to, emailVerifiedAt: null };
  // Only the repository operations used by these flows are implemented; no real DB.
  const db = {
    user: { findUnique: async () => (exists ? user : null) },
    session: {
      findUnique: async () => ({
        user,
        userId: user.id,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    },
    authToken: {
      create: async ({ data }: { data: (typeof created)[number] }) => {
        created.push(data);
        return { id: `token-${created.length}` };
      },
      delete: async ({ where }: { where: { id: string } }) => {
        deleted.push(where.id);
      },
    },
  };
  const service = createAuthService(
    db as unknown as Parameters<typeof createAuthService>[0],
    {
      origin: 'https://marketpulse.example',
      secret: 'a'.repeat(64),
      secure: true,
      ttlSeconds: 3600,
    },
    createAuthMailer(config, async (_url, init) => {
      const payload = JSON.parse(init?.body as string) as {
        textContent: string;
      };
      assert.match(
        payload.textContent,
        /^Open https:\/\/marketpulse.example\/(verify-email|reset-password)#token=/,
      );
      const token = payload.textContent.split('#token=')[1]!.split(' ')[0]!;
      assert.notEqual(created.at(-1)!.tokenHash, token);
      assert.equal(created.at(-1)!.tokenHash.length, 64);
      assert.ok(created.at(-1)!.expiresAt > new Date());
      return new Response('private provider failure', { status: 429 });
    }),
  );
  await assert.rejects(
    () => service.resend('existing-session'),
    /temporarily unavailable/,
  );
  assert.equal(created[0]?.purpose, 'VERIFY_EMAIL');
  assert.deepEqual(deleted, ['token-1']);
  assert.equal(await service.requestReset(mail.to), undefined);
  assert.equal(created[1]?.purpose, 'RESET_PASSWORD');
  assert.deepEqual(deleted, ['token-1', 'token-2']);
  exists = false;
  assert.equal(await service.requestReset('unknown@gmail.com'), undefined);
  assert.equal(created.length, 2);
});
