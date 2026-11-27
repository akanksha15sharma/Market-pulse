import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../../lib/api-client';
import { AuthPanel, FieldError, SubmitButton } from './AuthPanel';
import { PasswordField } from './PasswordField';
import { useAuthValidation } from './use-auth-validation';
import { authFailureMessage } from './form-validation';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const register = mode === 'register';
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const validation = useAuthValidation(mode);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    setError('');
    const result = validation.validate(event.currentTarget);
    if (!result.data) {
      setError('Please review the highlighted fields.');
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      await api(`/auth/${mode}`, { method: 'POST', body: result.data });
      await navigate('/account', { replace: true });
    } catch (failure) {
      setError(authFailureMessage(failure, mode));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <AuthPanel
      title={register ? 'Create your account' : 'Sign in'}
      description={
        register
          ? 'Save your watchlists and keep your market research in one place.'
          : 'Welcome back. Pick up where your market research left off.'
      }
      footer={
        <>
          <Link to={register ? '/login' : '/register'}>
            {register ? 'Already registered? Sign in' : 'Create an account'}
          </Link>
          {!register && <Link to="/forgot-password">Forgot password?</Link>}
        </>
      }
    >
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
          <legend className="sr-only">
            {register ? 'Registration details' : 'Sign-in details'}
          </legend>
          {register && (
            <div className="auth-field">
              <label htmlFor="displayName">Display name</label>
              <input
                id="displayName"
                name="displayName"
                autoComplete="name"
                maxLength={100}
                required
                aria-invalid={!!validation.errors.displayName}
                aria-describedby={
                  validation.errors.displayName
                    ? 'displayName-error'
                    : undefined
                }
              />
              <FieldError
                name="displayName"
                message={validation.errors.displayName}
              />
            </div>
          )}
          <div className="auth-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
              aria-invalid={!!validation.errors.email}
              aria-describedby={
                validation.errors.email ? 'email-error' : undefined
              }
            />
            <FieldError name="email" message={validation.errors.email} />
          </div>
          <PasswordField
            newPassword={register}
            error={validation.errors.password}
          />
          {register && (
            <PasswordField
              confirm
              newPassword
              error={validation.errors.confirmPassword}
            />
          )}
          {error && (
            <p role="alert" className="auth-error">
              {error}
            </p>
          )}
          <SubmitButton
            busy={busy}
            idle={register ? 'Create account' : 'Sign in'}
            pending={register ? 'Creating account…' : 'Signing in…'}
          />
        </fieldset>
      </form>
    </AuthPanel>
  );
}
