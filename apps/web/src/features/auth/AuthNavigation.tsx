import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { api, ApiError } from '../../lib/api-client';
import {
  sessionChangeEvent,
  sessionExpiredEvent,
  sessionChannel,
} from '../../lib/api-events';
import { createSessionStore, type SessionStatus } from './session-store';

export function SessionLinks({
  status,
  busy,
  retry,
  signOut,
}: {
  status: SessionStatus;
  busy: boolean;
  retry: () => void;
  signOut: () => void;
}) {
  if (status === 'loading')
    return (
      <span role="status" className="text-slate-300">
        Checking session…
      </span>
    );
  if (status === 'error')
    return (
      <button type="button" className="text-teal-300" onClick={retry}>
        Retry account status
      </button>
    );
  if (status === 'guest')
    return (
      <Link to="/login" className="text-teal-300">
        Sign in
      </Link>
    );
  return (
    <>
      <Link to="/account" className="text-slate-300 hover:text-teal-300">
        Account
      </Link>
      <button
        type="button"
        className="text-teal-300"
        disabled={busy}
        onClick={signOut}
      >
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
    </>
  );
}

export function AuthNavigation() {
  const [store] = useState(createSessionStore);
  const status = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => 'loading' as const,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const refresh = () => {
      setError('');
      void store.refresh();
    };
    const visible = () => {
      if (!document.hidden) refresh();
    };
    const expire = () => store.expire();
    refresh();
    window.addEventListener(sessionChangeEvent, refresh);
    window.addEventListener(sessionExpiredEvent, expire);
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    const timer = setInterval(() => {
      if (!document.hidden && store.getSnapshot() === 'authenticated')
        refresh();
    }, 60_000);
    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel(sessionChannel);
      channel.onmessage = refresh;
    } catch {
      /* Focus refresh supports browsers without BroadcastChannel. */
    }
    return () => {
      store.cancel();
      clearInterval(timer);
      channel?.close();
      window.removeEventListener(sessionChangeEvent, refresh);
      window.removeEventListener(sessionExpiredEvent, expire);
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [store, location.key]);
  async function signOut() {
    setBusy(true);
    setError('');
    try {
      await api('/auth/logout', { method: 'POST' });
      store.expire();
      await navigate('/login', { replace: true });
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) {
        store.expire();
        await navigate('/login', { replace: true });
      } else
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not sign out. Try again.',
        );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <SessionLinks
        status={status}
        busy={busy}
        retry={() => {
          void store.refresh();
        }}
        signOut={() => {
          void signOut();
        }}
      />
      {error && (
        <span role="alert" className="text-rose-300">
          {error}
        </span>
      )}
    </>
  );
}
