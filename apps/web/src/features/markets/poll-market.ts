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
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let blockedUntil = 0;
  let data: T | null = null;
  async function run() {
    clearTimeout(timer);
    if (visibility.hidden || running || controller.signal.aborted) return;
    if (Date.now() < blockedUntil) {
      timer = setTimeout(run, blockedUntil - Date.now());
      return;
    }
    running = true;
    try {
      data = await request(controller.signal);
      if (!controller.signal.aborted) receive(data);
    } catch (error) {
      if (!controller.signal.aborted) {
        blockedUntil =
          Date.now() +
          (error instanceof MarketRequestError ? error.retryMs : 60_000);
        fail(error);
      }
    } finally {
      running = false;
      if (!controller.signal.aborted && !visibility.hidden) {
        const delay =
          typeof interval === 'function' ? interval(data) : interval;
        timer = setTimeout(run, Math.max(delay, blockedUntil - Date.now()));
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
