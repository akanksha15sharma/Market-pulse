import type { ReactNode } from 'react';
export function AuthPanel({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <section
      className="market-dashboard workspace-page auth-page"
      aria-labelledby="auth-title"
    >
      <div className="market-panel auth-panel">
        <header className="auth-heading">
          <span className="brand-symbol" aria-hidden="true">
            M
          </span>
          <p className="eyebrow">Your MarketPulse account</p>
          <h1 id="auth-title">{title}</h1>
          <p className="auth-description">{description}</p>
        </header>
        {children}
        <footer className="auth-footer">{footer}</footer>
      </div>
    </section>
  );
}
export function FieldError({
  name,
  message,
}: {
  name: string;
  message?: string;
}) {
  return message ? (
    <p id={`${name}-error`} className="auth-field-error">
      {message}
    </p>
  ) : null;
}
export function SubmitButton({
  busy,
  idle,
  pending,
}: {
  busy: boolean;
  idle: string;
  pending: string;
}) {
  return (
    <>
      <button
        type="submit"
        disabled={busy}
        className="primary-button auth-submit"
      >
        {busy && <span className="auth-spinner" aria-hidden="true" />}
        {busy ? pending : idle}
      </button>
      <span className="sr-only" role="status">
        {busy ? pending : ''}
      </span>
    </>
  );
}
