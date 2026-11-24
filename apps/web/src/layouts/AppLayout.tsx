import { Link, NavLink, Outlet } from 'react-router';

export function AppLayout() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:block focus:p-4"
      >
        Skip to content
      </a>
      <header className="border-b border-slate-800">
        <nav
          aria-label="Main navigation"
          className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5"
        >
          <Link
            to="/"
            className="brand text-xl font-semibold tracking-tight text-teal-300"
          >
            <span className="brand-symbol" aria-hidden="true">
              M
            </span>{' '}
            MarketPulse
          </Link>
          <div className="nav-links flex gap-5 text-sm">
            <NavLink
              to="/markets"
              className="text-slate-300 hover:text-teal-300"
            >
              Markets
            </NavLink>
            <NavLink
              to="/watchlists"
              className="text-slate-300 hover:text-teal-300"
            >
              Watchlists
            </NavLink>
            <NavLink
              to="/alerts"
              className="text-slate-300 hover:text-teal-300"
            >
              Alerts
            </NavLink>
            <Link to="/account" className="text-slate-300 hover:text-teal-300">
              Account
            </Link>
            <Link to="/login" className="text-teal-300">
              Sign in
            </Link>
          </div>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-6 py-10">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-6xl px-6 py-8 text-sm text-slate-400">
        MarketPulse · Market tracking for informed research. USD only. No trade
        execution.
      </footer>
    </div>
  );
}
