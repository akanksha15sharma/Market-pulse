import { useEffect, useState } from 'react';
import { MarketRequestError } from './api';
import { pollMarket } from './poll-market';

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
    checkedAt: string | null;
  }>({ request, data: null, error: null, loading: true, checkedAt: null });
  useEffect(
    () =>
      pollMarket(
        request,
        interval,
        (data) =>
          setState({
            request,
            data,
            error: null,
            loading: false,
            checkedAt: new Date().toISOString(),
          }),
        (error) =>
          setState((previous) => ({
            request,
            data: previous.request === request ? previous.data : null,
            checkedAt: previous.request === request ? previous.checkedAt : null,
            error:
              error instanceof MarketRequestError
                ? error.message
                : 'Could not load market data. Check your connection and try again.',
            loading: false,
          })),
      ),
    [request, interval, revision],
  );
  return {
    ...(state.request === request
      ? state
      : { data: null, error: null, loading: true, checkedAt: null }),
    retry: () => setRevision((value) => value + 1),
  };
}
