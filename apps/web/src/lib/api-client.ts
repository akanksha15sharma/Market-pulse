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
    const data = (await csrf.json()) as { csrfToken: string };
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
  const body = (await response
    .json()
    .catch(() => ({ error: 'Unexpected server response. Try again.' }))) as {
    error?: string;
  };
  if (!response.ok)
    throw new ApiError(response.status, body.error ?? 'Request failed');
  return body as T;
}
