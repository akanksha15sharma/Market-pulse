import { useState } from 'react';
import { Link } from 'react-router';
import { useLinkToken } from '../features/auth/use-link-token';
import { api } from '../lib/api-client';
export function VerifyEmailPage() {
  const link = useLinkToken();
  return <VerifyEmailForm key={link.revision} token={link.token} />;
}
function VerifyEmailForm({ token }: { token: string }) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function verify() {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ message: string }>('/auth/verify-email', {
        method: 'POST',
        body: { token },
      });
      setMessage(result.message);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Try again');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="max-w-md">
      <h1 className="text-3xl font-semibold">Verify your email</h1>
      <p className="mt-4 text-slate-400">
        Confirm to use the verification link from your email.
      </p>
      {!message && (
        <button
          className="primary-button mt-6"
          disabled={busy || !token}
          onClick={() => {
            void verify();
          }}
        >
          {busy ? 'Verifying…' : 'Verify email'}
        </button>
      )}
      {!token && (
        <p className="mt-4">Open the verification link from your email.</p>
      )}
      <p role="status" className="mt-4 text-teal-300">
        {message}
      </p>
      {error && (
        <p role="alert" className="text-rose-300">
          {error}
        </p>
      )}
      <Link to="/account" className="mt-6 block text-teal-300">
        Your account
      </Link>
    </section>
  );
}
