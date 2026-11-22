import { useEffect, useState } from 'react';
import { MarketRequestError } from './api';

export function useMarketResource<T>(
  request: (signal: AbortSignal) => Promise<T>,
  interval: number | ((data: T | null) => number) = 60_000,
) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    request: typeof request;
    data: T | null;
    error: string | null;
    loading: boolean;
  }>({ request, data: null, error: null, loading: true });
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let running = false;
    let blockedUntil = 0;
    let data: T | null = null;
    async function run() {
      if (document.hidden || running || controller.signal.aborted) return;
      if (Date.now() < blockedUntil) {
        timer = setTimeout(run, blockedUntil - Date.now());
        return;
      }
      running = true;
      try {
        data = await request(controller.signal);
        if (!controller.signal.aborted)
          setState({ request, data, error: null, loading: false });
      } catch (error) {
        if (!controller.signal.aborted) {
          const message =
            error instanceof MarketRequestError
              ? error.message
              : 'Could not load market data. Check your connection and try again.';
          blockedUntil =
            Date.now() +
            (error instanceof MarketRequestError ? error.retryMs : 60_000);
          setState((previous) => ({
            request,
            data: previous.request === request ? previous.data : null,
            error: message,
            loading: false,
          }));
        }
      } finally {
        running = false;
        if (!controller.signal.aborted) {
          const delay =
            typeof interval === 'function' ? interval(data) : interval;
          timer = setTimeout(run, Math.max(delay, blockedUntil - Date.now()));
        }
      }
    }
    const visibility = () => {
      clearTimeout(timer);
      if (!document.hidden) void run();
    };
    document.addEventListener('visibilitychange', visibility);
    void run();
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [request, interval, revision]);
  return {
    ...(state.request === request
      ? state
      : { data: null, error: null, loading: true }),
    retry: () => setRevision((value) => value + 1),
  };
}
