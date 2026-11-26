import { announceApiWrite, sessionChangeEvent } from './api-events';
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
type ApiOptions = { method?: string; body?: unknown; signal?: AbortSignal };
let pendingWrite: Promise<unknown> = Promise.resolve();
export async function api<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  if ((options.method ?? 'GET') === 'GET') return request<T>(path, options);
  let sessionChanged = false;
  const invalidate = () => {
    sessionChanged = true;
  };
  if (typeof window !== 'undefined')
    window.addEventListener(sessionChangeEvent, invalidate);
  const perform = () => {
    if (sessionChanged)
      throw new ApiError(
        409,
        'Your session changed. Refresh the page before trying again.',
      );
    return request<T>(path, options);
  };
  const secured = async (): Promise<T> =>
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    navigator.locks
      ? await navigator.locks.request('marketpulse-csrf-write', perform)
      : await perform();
  // Keep token issuance and its write together; reads remain independent. A failed
  // write releases the queue without replaying that business operation.
  const result = pendingWrite.then(secured, secured);
  pendingWrite = result.then(
    () => undefined,
    () => undefined,
  );
  try {
    return await result;
  } finally {
    if (typeof window !== 'undefined')
      window.removeEventListener(sessionChangeEvent, invalidate);
  }
}
async function request<T>(path: string, options: ApiOptions): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    const csrf = await fetch('/api/v1/auth/csrf', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {
      throw new ApiError(
        0,
        'Cannot secure the request. Check your connection and try again.',
      );
    });
    if (!csrf.ok)
      throw new ApiError(
        csrf.status,
        'Could not secure the request. Try again.',
      );
    const data: unknown = await csrf.json().catch(() => null);
    if (
      !data ||
      typeof data !== 'object' ||
      !('csrfToken' in data) ||
      typeof data.csrfToken !== 'string' ||
      !data.csrfToken.trim()
    )
      throw new ApiError(0, 'Could not secure the request. Try again.');
    headers['X-CSRF-Token'] = data.csrfToken;
    headers['Content-Type'] = 'application/json';
  }
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
    });
  } catch {
    throw new ApiError(
      0,
      'Cannot reach MarketPulse. Check your connection and try again.',
    );
  }
  if (response.status === 204) {
    if (method !== 'GET') announceApiWrite(path);
    return undefined as T;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(
      response.ok ? 502 : response.status,
      'Unexpected server response. Try again.',
    );
  }
  if (!response.ok) {
    const message =
      body &&
      typeof body === 'object' &&
      'error' in body &&
      typeof body.error === 'string' &&
      body.error.trim()
        ? body.error
        : 'Request failed. Try again.';
    throw new ApiError(response.status, message);
  }
  if (method !== 'GET') announceApiWrite(path);
  return body as T;
}
