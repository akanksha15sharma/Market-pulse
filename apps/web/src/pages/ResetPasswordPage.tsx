import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { tokenSchema } from '@marketpulse/contracts';
import { useLinkToken } from '../features/auth/use-link-token';
import { AuthPanel, SubmitButton } from '../features/auth/AuthPanel';
import { PasswordField } from '../features/auth/PasswordField';
import { useAuthValidation } from '../features/auth/use-auth-validation';
import { authFailureMessage } from '../features/auth/form-validation';
import { api } from '../lib/api-client';
export function ResetPasswordPage() {
  const link = useLinkToken();
  return <ResetPasswordForm key={link.revision} token={link.token} />;
}
function ResetPasswordForm({ token }: { token: string }) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const validation = useAuthValidation('reset', token);
  const validLink = tokenSchema.safeParse(token).success;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !validLink) return;
    setError('');
    const result = validation.validate(event.currentTarget);
    if (!result.data) {
      setError('Please review the highlighted fields.');
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      await api('/auth/reset-password', { method: 'POST', body: result.data });
      setMessage('Password reset. Sign in again with your new password.');
    } catch (failure) {
      setError(authFailureMessage(failure, 'reset'));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <AuthPanel
      title="Choose a new password"
      description="Use a password you haven’t used elsewhere. Your existing sessions will end after a successful reset."
      footer={
        <>
          <Link to="/login">Sign in</Link>
          <Link to="/forgot-password">Request a new reset link</Link>
        </>
      }
    >
      {message ? (
        <div className="auth-result">
          <h2>Your password is updated</h2>
          <p role="status">{message}</p>
        </div>
      ) : !validLink ? (
        <div className="auth-result auth-invalid-link" role="alert">
          <h2>A new reset link is needed</h2>
          <p>
            This reset link is missing or invalid. Open the link from your
            email, or request a new one.
          </p>
        </div>
      ) : (
        <form
          className="auth-form"
          noValidate
          aria-busy={busy}
          onSubmit={(event) => {
            void submit(event);
          }}
          onBlur={validation.blur}
          onChange={(event) => {
            validation.change(event);
            setError('');
          }}
        >
          <fieldset disabled={busy}>
            <legend className="sr-only">New password details</legend>
            <PasswordField newPassword error={validation.errors.password} />
            <PasswordField
              confirm
              newPassword
              error={validation.errors.confirmPassword}
            />
            {error && (
              <p role="alert" className="auth-error">
                {error}
              </p>
            )}
            <SubmitButton
              busy={busy}
              idle="Reset password"
              pending="Resetting password…"
            />
          </fieldset>
        </form>
      )}
    </AuthPanel>
  );
}
