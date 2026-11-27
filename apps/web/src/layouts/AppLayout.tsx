import { NotificationProvider } from '../features/notifications/NotificationProvider';
import { Navbar } from './Navbar';
import { Outlet } from 'react-router';

export function AppLayout() {
  return (
    <NotificationProvider>
      <AppShell />
    </NotificationProvider>
  );
}
function AppShell() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:block focus:p-4"
      >
        Skip to content
      </a>
      <Navbar />
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
