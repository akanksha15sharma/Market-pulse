import { useEffect, useSyncExternalStore } from 'react';
const eventName = 'marketpulse-theme';
function snapshot(): 'dark' | 'light' {
  try {
    const value = localStorage.getItem(eventName);
    if (value === 'dark' || value === 'light') return value;
  } catch {
    /* Storage may be disabled. */
  }
  const current = document.documentElement.dataset.theme;
  if (current === 'light' || current === 'dark') return current;
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}
function subscribe(notify: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: light)');
  window.addEventListener(eventName, notify);
  window.addEventListener('storage', notify);
  media.addEventListener('change', notify);
  return () => {
    window.removeEventListener(eventName, notify);
    window.removeEventListener('storage', notify);
    media.removeEventListener('change', notify);
  };
}
export function useMarketTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    snapshot,
    () => 'dark' as const,
  );
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return {
    theme,
    toggle: () => {
      const next = theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem(eventName, next);
      } catch {
        /* Theme still works for this page. */
      }
      window.dispatchEvent(new Event(eventName));
    },
  };
}
