import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { resetPasswordSchema } from '@marketpulse/contracts';
import { useLinkToken } from '../features/auth/use-link-token';
import { api } from '../lib/api-client';
export function ResetPasswordPage() {
  const token = useLinkToken();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get('password');
    const parsed = resetPasswordSchema.safeParse({ token, password });
    if (!parsed.success) {
      setError('Use a valid reset link and a password of 12–128 characters.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await api<{ message: string }>('/auth/reset-password', {
        method: 'POST',
        body: parsed.data,
      });
      setMessage(result.message);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Try again');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold">Choose a new password</h1>
      {!message && (
        <form
          className="mt-8 space-y-5"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <label className="block">
            New password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
          </label>
          <button disabled={busy || !token} className="primary-button">
            {busy ? 'Please wait…' : 'Reset password'}
          </button>
        </form>
      )}
      {!token && <p className="mt-4">Open the reset link from your email.</p>}
      <p role="status" className="mt-4 text-teal-300">
        {message}
      </p>
      {error && (
        <p role="alert" className="text-rose-300">
          {error}
        </p>
      )}
      <Link to="/login" className="mt-6 inline-block text-teal-300">
        Sign in
      </Link>
    </section>
  );
}
