import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { tokenSchema } from '@marketpulse/contracts';
import { useLinkToken } from '../features/auth/use-link-token';
import { AuthPanel, SubmitButton } from '../features/auth/AuthPanel';
import { authFailureMessage } from '../features/auth/form-validation';
import { api } from '../lib/api-client';
export function VerifyEmailPage() {
  const link = useLinkToken();
  return <VerifyEmailForm key={link.revision} token={link.token} />;
}
function VerifyEmailForm({ token }: { token: string }) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const validLink = tokenSchema.safeParse(token).success;
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !validLink) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await api('/auth/verify-email', { method: 'POST', body: { token } });
      setMessage('Email verified. You can return to your account.');
    } catch (failure) {
      setError(authFailureMessage(failure, 'verify'));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <AuthPanel
      title="Verify your email"
      description="Confirm your email address to keep your MarketPulse account up to date."
      footer={
        <>
          <Link to="/account">Your account</Link>
          <Link to="/login">Sign in</Link>
        </>
      }
    >
      {message ? (
        <div className="auth-result">
          <h2>Your email is verified</h2>
          <p role="status">{message}</p>
        </div>
      ) : !validLink ? (
        <div className="auth-result auth-invalid-link" role="alert">
          <h2>A new verification link is needed</h2>
          <p>
            This verification link is missing or invalid. Open the link from
            your email, or request a new one from your account.
          </p>
        </div>
      ) : (
        <form
          className="auth-form"
          aria-busy={busy}
          onSubmit={(event) => {
            void verify(event);
          }}
        >
          <fieldset disabled={busy}>
            <legend className="sr-only">Email verification</legend>
            <p className="auth-hint">
              Select Verify email to use this one-time link. Verification does
              not sign you in.
            </p>
            {error && (
              <p role="alert" className="auth-error">
                {error}
              </p>
            )}
            <SubmitButton
              busy={busy}
              idle="Verify email"
              pending="Verifying…"
            />
          </fieldset>
        </form>
      )}
    </AuthPanel>
  );
}
