import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api-client';
import {
  AuthPanel,
  FieldError,
  SubmitButton,
} from '../features/auth/AuthPanel';
import { useAuthValidation } from '../features/auth/use-auth-validation';
import { authFailureMessage } from '../features/auth/form-validation';

export function ForgotPasswordPage() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const validation = useAuthValidation('forgot');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    setError('');
    const result = validation.validate(event.currentTarget);
    if (!result.data) {
      setError('Please review the highlighted field.');
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      await api('/auth/forgot-password', { method: 'POST', body: result.data });
      // Identical outcome for known and unknown addresses, including delivery failures.
      setMessage(
        'If the account exists, a reset email will be sent. Check your inbox and spam folder.',
      );
    } catch (failure) {
      setError(authFailureMessage(failure, 'forgot'));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <AuthPanel
      title="Reset your password"
      description="Enter your account email and we’ll help you get back in."
      footer={<Link to="/login">Back to sign in</Link>}
    >
      {message ? (
        <div className="auth-result">
          <h2>Check your email</h2>
          <p role="status">{message}</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setMessage('')}
          >
            Use another email
          </button>
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
            <legend className="sr-only">Account recovery</legend>
            <div className="auth-field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                aria-invalid={!!validation.errors.email}
                aria-describedby={
                  validation.errors.email ? 'email-error' : undefined
                }
              />
              <FieldError name="email" message={validation.errors.email} />
            </div>
            {error && (
              <p role="alert" className="auth-error">
                {error}
              </p>
            )}
            <SubmitButton
              busy={busy}
              idle="Request reset link"
              pending="Sending link…"
            />
          </fieldset>
        </form>
      )}
    </AuthPanel>
  );
}
