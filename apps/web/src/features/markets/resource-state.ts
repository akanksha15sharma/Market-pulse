export type MarketRequest<T> = (signal: AbortSignal) => Promise<T>;
export type ResourceState<T> = {
  request: MarketRequest<T>;
  data: T | null;
  error: string | null;
  loading: boolean;
  checkedAt: string | null;
};
type ResourceEvent<T> =
  | { type: 'start'; request: MarketRequest<T> }
  | { type: 'success'; request: MarketRequest<T>; data: T; checkedAt: string }
  | { type: 'failure'; request: MarketRequest<T>; error: string };

export function initialResourceState<T>(
  request: MarketRequest<T>,
): ResourceState<T> {
  return { request, data: null, error: null, loading: true, checkedAt: null };
}

export function resourceReducer<T>(
  previous: ResourceState<T>,
  event: ResourceEvent<T>,
): ResourceState<T> {
  const state =
    previous.request === event.request
      ? previous
      : initialResourceState(event.request);
  switch (event.type) {
    case 'start':
      return { ...state, loading: true, error: null };
    case 'success':
      return {
        request: event.request,
        data: event.data,
        checkedAt: event.checkedAt,
        error: null,
        loading: false,
      };
    case 'failure':
      return { ...state, error: event.error, loading: false };
  }
}
