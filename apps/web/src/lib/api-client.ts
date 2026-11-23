export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
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
      signal: AbortSignal.timeout(10_000),
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
  if (response.status === 204) return undefined as T;
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
  return body as T;
}
