export const sessionExpiredEvent = 'marketpulse-session-expired';
export const notificationChangeEvent = 'marketpulse-notifications-changed';
export const sessionChangeEvent = 'marketpulse-session-changed';
export const sessionChannel = 'marketpulse-session';
export function announceApiWrite(path: string) {
  if (typeof window === 'undefined') return;
  const sessionChanged =
    /^\/auth\/(login|register|logout|reset-password)$/.test(path) ||
    /^\/auth\/sessions\//.test(path);
  window.dispatchEvent(
    new Event(sessionChanged ? sessionChangeEvent : notificationChangeEvent),
  );
  if (sessionChanged && typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(sessionChannel);
      channel.postMessage('changed'); // No identity, count or credential crosses tabs.
      channel.close();
    } catch {
      // Restricted browsers refresh private state when their tab becomes visible.
      // A signalling failure must never disguise a successful API write as failed.
    }
  }
}
