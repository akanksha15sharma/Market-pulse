import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { emailRequestSchema } from '@marketpulse/contracts';
import { api } from '../lib/api-client';
export function ForgotPasswordPage() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = new FormData(event.currentTarget).get('email');
    const parsed = emailRequestSchema.safeParse({ email });
    if (!parsed.success) {
      setError('Enter a valid email');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api<{ message: string }>('/auth/forgot-password', {
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
      <h1 className="text-3xl font-semibold">Reset your password</h1>
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
        className="mt-8 space-y-5"
      >
        <label className="block">
          Email
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            maxLength={254}
          />
        </label>
        <button className="primary-button" disabled={busy}>
          {busy ? 'Please wait…' : 'Request reset link'}
        </button>
      </form>
      <p role="status" className="mt-4 text-teal-300">
        {message}
      </p>
      {error && (
        <p role="alert" className="mt-4 text-rose-300">
          {error}
        </p>
      )}
      <Link to="/login" className="mt-6 inline-block text-teal-300">
        Back to sign in
      </Link>
    </section>
  );
}
