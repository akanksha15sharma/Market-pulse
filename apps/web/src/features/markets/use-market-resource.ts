import { useEffect, useReducer, useState } from 'react';
import { MarketRequestError } from './api';
import { pollMarket } from './poll-market';
import { initialResourceState, resourceReducer } from './resource-state';

export function useMarketResource<T>(
  request: (signal: AbortSignal) => Promise<T>,
  interval: number | ((data: T | null) => number) = 60_000,
) {
  const [revision, setRevision] = useState(0);
  const [state, dispatch] = useReducer(
    resourceReducer<T>,
    request,
    initialResourceState<T>,
  );
  useEffect(
    () =>
      pollMarket(
        request,
        interval,
        (data) =>
          dispatch({
            type: 'success',
            request,
            data,
            checkedAt: new Date().toISOString(),
          }),
        (error) =>
          dispatch({
            type: 'failure',
            request,
            error:
              error instanceof MarketRequestError
                ? error.message
                : 'Could not load market data. Check your connection and try again.',
          }),
        undefined,
        () => dispatch({ type: 'start', request }),
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
