import { Link, Outlet } from 'react-router';

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
            className="text-xl font-semibold tracking-tight text-teal-300"
          >
            MarketPulse
          </Link>
          <span className="text-sm text-slate-400">
            Crypto &amp; stock tracker
          </span>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-6 py-16">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-6xl px-6 py-8 text-sm text-slate-400">
        A software engineering portfolio project.
      </footer>
    </div>
  );
}
