import { useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router';

export function ProfileDropdown({
  busy,
  signOut,
}: {
  busy: boolean;
  signOut: () => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const location = useLocation();
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [location.key]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node))
        ref.current.open = false;
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  return (
    <details
      className="profile-dropdown"
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && ref.current?.open) {
          event.preventDefault();
          event.stopPropagation();
          ref.current.open = false;
          ref.current.querySelector('summary')?.focus();
        }
      }}
    >
      <summary className="profile-trigger">
        <span className="profile-avatar" aria-hidden="true">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
          </svg>
        </span>
        <span>Profile</span>
        <svg
          className="profile-chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="profile-panel">
        <p className="profile-caption">Your MarketPulse</p>
        <NavLink to="/account" className="profile-action">
          Account
        </NavLink>
        <NavLink
          to="/notifications#notification-preferences-title"
          className="profile-action"
        >
          Notification preferences
        </NavLink>
        <div className="profile-divider" />
        <button
          type="button"
          className="profile-action profile-signout"
          disabled={busy}
          onClick={signOut}
        >
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </details>
  );
}
