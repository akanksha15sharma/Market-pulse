import { useState } from 'react';
import { FieldError } from './AuthPanel';
export function PasswordField({
  confirm = false,
  newPassword = false,
  error,
}: {
  confirm?: boolean;
  newPassword?: boolean;
  error?: string;
}) {
  const [visible, setVisible] = useState(false);
  const name = confirm ? 'confirmPassword' : 'password';
  const label = confirm
    ? 'Confirm password'
    : newPassword
      ? 'New password'
      : 'Password';
  const hint = newPassword && !confirm;
  return (
    <div className="auth-field">
      <label htmlFor={name}>{label}</label>
      <div className="auth-password-control">
        <input
          id={name}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete={
            newPassword || confirm ? 'new-password' : 'current-password'
          }
          minLength={newPassword ? 12 : 1}
          maxLength={128}
          required
          aria-invalid={!!error}
          aria-describedby={
            [hint ? 'password-hint' : '', error ? `${name}-error` : '']
              .filter(Boolean)
              .join(' ') || undefined
          }
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((value) => !value)}
          aria-label={`${visible ? 'Hide' : 'Show'} ${confirm ? 'confirmation password' : 'password'}`}
          aria-pressed={visible}
          aria-controls={name}
          title={`${visible ? 'Hide' : 'Show'} password`}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
            <circle cx="12" cy="12" r="3" />
            {visible && <path d="m3 3 18 18" />}
          </svg>
        </button>
      </div>
      {hint && (
        <p id="password-hint" className="auth-hint">
          Use 12–128 characters. Passphrases and password managers are welcome.
        </p>
      )}
      <FieldError name={name} message={error} />
    </div>
  );
}
