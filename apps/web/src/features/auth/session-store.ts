import { publicUserSchema } from '@marketpulse/contracts';
import { api, ApiError } from '../../lib/api-client';

export type SessionStatus = 'loading' | 'authenticated' | 'guest' | 'error';
export function createSessionStore(
  load: (signal: AbortSignal) => Promise<unknown> = (signal) =>
    api('/auth/me', { signal }),
) {
  let status: SessionStatus = 'loading';
  let controller: AbortController | undefined;
  const listeners = new Set<() => void>();
  const set = (next: SessionStatus) => {
    status = next;
    listeners.forEach((listener) => listener());
  };
  const cancel = () => controller?.abort();
  return {
    getSnapshot: () => status,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    cancel,
    expire() {
      cancel();
      set('guest');
    },
    async refresh() {
      cancel();
      const current = new AbortController();
      controller = current;
      set('loading');
      try {
        const result = await load(current.signal);
        if (current.signal.aborted) return;
        const user = publicUserSchema.safeParse(
          result && typeof result === 'object' && 'user' in result
            ? result.user
            : undefined,
        );
        set(user.success ? 'authenticated' : 'error');
      } catch (error) {
        if (current.signal.aborted) return;
        set(
          error instanceof ApiError && error.status === 401 ? 'guest' : 'error',
        );
      }
    },
  };
}
