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
    <section className="market-dashboard workspace-page account-page">
      <div className="market-heading">
        <div>
          <p className="eyebrow">Account & security</p>
          <h1>Your account</h1>
          <p className="market-subtitle">
            Your profile, email verification and signed-in devices.
          </p>
        </div>
      </div>
      <p role="status" className="workspace-feedback" aria-live="polite">
        {status}
      </p>
      {error && (
        <p role="alert" className="market-error">
          {error}
        </p>
      )}
      <div className="account-layout">
        <section
          className="market-panel account-profile"
          aria-labelledby="profile-heading"
        >
          <div className="panel-heading">
            <h2 id="profile-heading">Profile</h2>
            <span className="workspace-badge">Private account</span>
          </div>
          <dl className="account-details">
            <div>
              <dt>Display name</dt>
              <dd>{user.displayName}</dd>
            </div>
            <div>
              <dt>Email address</dt>
              <dd>{user.email}</dd>
            </div>
          </dl>
          <div className="account-verification">
            <h3>
              Email {user.emailVerified ? 'verified' : 'not yet verified'}
            </h3>
            {user.emailVerified ? (
              <p className="muted">Your email address has been verified.</p>
            ) : (
              <>
                <p className="muted">
                  Request a verification link sent to your email address. Check
                  your spam folder if it does not arrive.
                </p>
                <button
                  disabled={busy}
                  className="secondary-button"
                  onClick={() => {
                    void perform(async () => {
                      await api('/auth/resend-verification', {
                        method: 'POST',
                      });
                      setStatus('Verification email requested.');
                    });
                  }}
                >
                  Send verification link
                </button>
              </>
            )}
          </div>
        </section>
        <section
          className="market-panel account-sessions"
          aria-labelledby="sessions-heading"
        >
          <div className="panel-heading">
            <div>
              <h2 id="sessions-heading">Active sessions</h2>
              <p>Review where you are signed in.</p>
            </div>
            <span className="workspace-badge">
              {sessions.length} {sessions.length === 1 ? 'session' : 'sessions'}
            </span>
          </div>
          {sessions.length ? (
            <ul className="account-session-list">
              {sessions.map((session) => (
                <li key={session.id}>
                  <div>
                    <p className="account-session-title">
                      {session.current
                        ? 'This session'
                        : 'Another signed-in session'}
                    </p>
                    <p className="muted">
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
          ) : (
            <div className="catalog-empty">
              <h3>No sessions to display</h3>
              <p>Refresh your account to check for active sessions.</p>
              <button
                className="secondary-button"
                disabled={busy || revalidator.state !== 'idle'}
                onClick={() => {
                  void revalidator.revalidate();
                }}
              >
                Refresh sessions
              </button>
            </div>
          )}
        </section>
      </div>
      <section
        className="market-panel account-signout"
        aria-labelledby="signout-heading"
      >
        <div>
          <h2 id="signout-heading">Sign out on this device</h2>
          <p className="muted">
            End your current session. You can sign in again whenever you need.
          </p>
        </div>
        <button
          className="secondary-button"
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
    </section>
  );
}
