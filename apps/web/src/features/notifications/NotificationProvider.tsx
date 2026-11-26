import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router';
import { ApiError } from '../../lib/api-client';
import {
  notificationChangeEvent,
  sessionChangeEvent,
  sessionChannel,
} from '../../lib/api-events';
import { loadNotificationSummary } from './api';
import { NotificationContext, type NotificationState } from './context';

export function NotificationProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [state, setState] = useState<NotificationState>({
    status: 'loading',
    unreadCount: null,
    revision: 0,
  });
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  const activeRequest = useRef<AbortController | undefined>(undefined);
  const expire = useCallback(() => {
    activeRequest.current?.abort();
    setState((previous) => ({
      status: 'guest',
      unreadCount: null,
      revision: previous.revision + 1,
    }));
  }, []);
  useEffect(() => {
    let controller: AbortController | undefined;
    let alive = true;
    let authenticated = false;
    async function update() {
      controller?.abort();
      const current = new AbortController();
      controller = current;
      activeRequest.current = current;
      try {
        const summary = await loadNotificationSummary(current.signal);
        if (!alive || current.signal.aborted) return;
        authenticated = true;
        setState((previous) => ({
          ...previous,
          status: summary.enabled ? 'ready' : 'disabled',
          unreadCount: summary.unreadCount,
        }));
      } catch (error) {
        if (!alive || current.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          authenticated = false;
          expire();
        } else
          setState((previous) => ({
            ...previous,
            status: 'error',
            unreadCount: null,
          }));
      }
    }
    const run = () => {
      void update();
    };
    const reset = () => {
      setState((previous) => ({
        status: 'loading',
        unreadCount: null,
        revision: previous.revision + 1,
      }));
      run();
    };
    const visible = () => {
      if (!document.hidden) reset();
    };
    refreshRef.current = run;
    run();
    const timer = setInterval(() => {
      if (authenticated && !document.hidden) run();
    }, 60_000);
    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined')
        channel = new BroadcastChannel(sessionChannel);
    } catch {
      // Visibility refresh still invalidates private state if cross-tab messaging is blocked.
    }
    if (channel)
      channel.onmessage = () =>
        window.dispatchEvent(new Event(sessionChangeEvent));
    window.addEventListener(sessionChangeEvent, reset);
    window.addEventListener(notificationChangeEvent, run);
    document.addEventListener('visibilitychange', visible);
    return () => {
      alive = false;
      controller?.abort();
      clearInterval(timer);
      channel?.close();
      window.removeEventListener(sessionChangeEvent, reset);
      window.removeEventListener(notificationChangeEvent, run);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [location.key, expire]);
  return (
    <NotificationContext.Provider value={{ ...state, refresh, expire }}>
      {children}
    </NotificationContext.Provider>
  );
}
