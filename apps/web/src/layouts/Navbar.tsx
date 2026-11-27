import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { AuthNavigation } from '../features/auth/AuthNavigation';
import { NotificationBell } from '../features/notifications/NotificationBell';
import { useMarketTheme } from '../features/markets/theme';

export function Navbar() {
  const { theme, toggle } = useMarketTheme();
  const location = useLocation();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const open = openKey === location.key;
  const navigation = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!navigation.current?.contains(event.target as Node)) setOpenKey(null);
    };
    const escape = (event: KeyboardEvent) => {
      // Nested profile disclosure handles its own Escape first.
      if (event.key === 'Escape' && !event.defaultPrevented && open) {
        setOpenKey(null);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <header className="site-header">
      <nav ref={navigation} aria-label="Main navigation" className="site-nav">
        <Link to="/" className="brand nav-brand" aria-label="MarketPulse home">
          <span className="brand-symbol" aria-hidden="true">
            M
          </span>
          MarketPulse
        </Link>
        <div className="nav-tools">
          <button
            type="button"
            className="theme-toggle nav-icon-button"
            onClick={toggle}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
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
              {theme === 'dark' ? (
                <>
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
                </>
              ) : (
                <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z" />
              )}
            </svg>
          </button>
          <button
            ref={trigger}
            type="button"
            className="mobile-nav-toggle nav-icon-button"
            aria-label={open ? 'Close navigation' : 'Open navigation'}
            aria-expanded={open}
            aria-controls="primary-navigation"
            onClick={() => setOpenKey(open ? null : location.key)}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path
                d={open ? 'M6 6l12 12M6 18 18 6' : 'M4 6h16M4 12h16M4 18h16'}
              />
            </svg>
          </button>
        </div>
        <div id="primary-navigation" className="nav-links" data-open={open}>
          <div className="nav-primary-links">
            <NavLink
              to="/markets"
              className={({ isActive }) =>
                `nav-link${isActive || location.pathname === '/' || location.pathname.startsWith('/assets/') ? ' is-active' : ''}`
              }
            >
              Markets
            </NavLink>
            <NavLink to="/watchlists" className="nav-link">
              Watchlists
            </NavLink>
            <NavLink to="/alerts" className="nav-link">
              Alerts
            </NavLink>
          </div>
          <div className="nav-account-links">
            <NotificationBell />
            <AuthNavigation />
          </div>
        </div>
      </nav>
    </header>
  );
}
