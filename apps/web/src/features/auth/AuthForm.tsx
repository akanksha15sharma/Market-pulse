import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { loginSchema, registerSchema } from '@marketpulse/contracts';
import { api } from '../../lib/api-client';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const register = mode === 'register';
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      email: form.get('email'),
      password: form.get('password'),
      ...(register ? { displayName: form.get('displayName') } : {}),
    };
    const parsed = (register ? registerSchema : loginSchema).safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api(`/auth/${mode}`, { method: 'POST', body: parsed.data });
      await navigate('/account', { replace: true });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Please try again');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-md">
      <h1 className="text-3xl font-semibold">
        {register ? 'Create your account' : 'Sign in'}
      </h1>
      <p className="mt-3 text-slate-400">
        {register
          ? 'Start with a secure MarketPulse account.'
          : 'Welcome back to MarketPulse.'}
      </p>
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
        className="mt-8 space-y-5"
      >
        {register && (
          <label className="block">
            Display name
            <input
              name="displayName"
              autoComplete="name"
              maxLength={100}
              required
            />
          </label>
        )}
        <label className="block">
          Email
          <input
            name="email"
            type="email"
            autoComplete="email"
            maxLength={254}
            required
          />
        </label>
        <label className="block">
          Password
          <input
            name="password"
            type="password"
            autoComplete={register ? 'new-password' : 'current-password'}
            minLength={register ? 12 : 1}
            maxLength={128}
            required
            aria-describedby={register ? 'password-hint' : undefined}
          />
        </label>
        {register && (
          <p id="password-hint" className="text-sm text-slate-400">
            Use 12–128 characters. Passphrases and password managers are
            welcome.
          </p>
        )}
        {error && (
          <p role="alert" className="text-rose-300">
            {error}
          </p>
        )}
        <button disabled={busy} className="primary-button">
          {busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <div className="mt-6 flex flex-wrap gap-4 text-teal-300">
        <Link to={register ? '/login' : '/register'}>
          {register ? 'Already registered? Sign in' : 'Create an account'}
        </Link>
        {!register && <Link to="/forgot-password">Forgot password?</Link>}
      </div>
    </section>
  );
}
