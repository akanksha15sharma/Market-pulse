import { useState } from 'react';
import { useLoaderData, useNavigate, useRevalidator } from 'react-router';
import type { accountLoader } from '../features/auth/loaders';
import { api } from '../lib/api-client';

export function AccountPage() {
  const { user, sessions } = useLoaderData<typeof accountLoader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Try again');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="max-w-2xl">
      <h1 className="text-3xl font-semibold">Your account</h1>
      <p className="mt-4">{user.displayName}</p>
      <p className="break-all text-slate-400">{user.email}</p>
      <div className="mt-6 rounded-xl border border-slate-700 p-5">
        <h2 className="font-semibold">
          Email {user.emailVerified ? 'verified' : 'not yet verified'}
        </h2>
        {!user.emailVerified && (
          <>
            <p className="mt-2 text-sm text-slate-400">
              Request a verification link sent to your email address. Check your
              spam folder if it does not arrive.
            </p>
            <button
              disabled={busy}
              className="secondary-button mt-4"
              onClick={() => {
                void perform(async () => {
                  await api('/auth/resend-verification', { method: 'POST' });
                  setStatus('Verification email requested.');
                });
              }}
            >
              Send verification link
            </button>
          </>
        )}
      </div>
      <h2 className="mt-8 text-xl font-semibold">Active sessions</h2>
      <ul className="mt-4 space-y-4">
        {sessions.map((session) => (
          <li
            key={session.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 p-4"
          >
            <div>
              <p>
                {session.current ? 'This session' : 'Another signed-in session'}
              </p>
              <p className="text-sm text-slate-400">
                Expires {new Date(session.expiresAt).toLocaleString()}
              </p>
            </div>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                void perform(async () => {
                  await api(`/auth/sessions/${session.id}`, {
                    method: 'DELETE',
                  });
                  if (session.current)
                    await navigate('/login', { replace: true });
                  else await revalidator.revalidate();
                });
              }}
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
      <p role="status" className="mt-4 text-teal-300">
        {status}
      </p>
      {error && (
        <p role="alert" className="text-rose-300">
          {error}
        </p>
      )}
      <button
        className="primary-button mt-8"
        disabled={busy}
        onClick={() => {
          void perform(async () => {
            await api('/auth/logout', { method: 'POST' });
            await navigate('/login', { replace: true });
          });
        }}
      >
        Sign out
      </button>
    </section>
  );
}
