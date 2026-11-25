import { MarketRequestError } from './api';

// One request and one timer per mounted resource; never poll hidden tabs.
export function pollMarket<T>(
  request: (signal: AbortSignal) => Promise<T>,
  interval: number | ((data: T | null) => number),
  receive: (data: T) => void,
  fail: (error: unknown) => void,
  visibility: Pick<
    Document,
    'hidden' | 'addEventListener' | 'removeEventListener'
  > = document,
  start: () => void = () => {},
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let blockedUntil = 0;
  let data: T | null = null;
  let failures = 0;
  async function run() {
    clearTimeout(timer);
    if (visibility.hidden || running || controller.signal.aborted) return;
    if (Date.now() < blockedUntil) {
      timer = setTimeout(run, blockedUntil - Date.now());
      return;
    }
    running = true;
    let failed = false;
    try {
      start();
      data = await request(controller.signal);
      failures = 0;
      blockedUntil = 0;
      if (!controller.signal.aborted) receive(data);
    } catch (error) {
      if (!controller.signal.aborted) {
        failed = true;
        failures++;
        const minimum =
          error instanceof MarketRequestError ? error.retryMs : 60_000;
        // Short transient retries back off to one minute; Retry-After is never shortened.
        const backoff =
          minimum < 60_000
            ? Math.min(60_000, minimum * 2 ** Math.min(failures - 1, 4))
            : minimum;
        blockedUntil = Date.now() + backoff;
        fail(error);
      }
    } finally {
      running = false;
      if (!controller.signal.aborted && !visibility.hidden) {
        const delay =
          typeof interval === 'function' ? interval(data) : interval;
        timer = setTimeout(
          run,
          failed ? Math.max(0, blockedUntil - Date.now()) : delay,
        );
      }
    }
  }
  const onVisibility = () => {
    clearTimeout(timer);
    if (!visibility.hidden) void run();
  };
  visibility.addEventListener('visibilitychange', onVisibility);
  void run();
  return () => {
    controller.abort();
    clearTimeout(timer);
    visibility.removeEventListener('visibilitychange', onVisibility);
  };
}
