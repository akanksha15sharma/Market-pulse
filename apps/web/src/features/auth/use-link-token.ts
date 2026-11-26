import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';

export function useLinkToken() {
  const location = useLocation();
  const [link, setLink] = useState(() => ({
    token:
      new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '',
    revision: 0,
  }));
  const initialized = useRef(false);
  useEffect(() => {
    const clearFragment = () =>
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search,
      );
    const consume = () => {
      if (!window.location.hash) return;
      const token =
        new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
      setLink((previous) => ({ token, revision: previous.revision + 1 }));
      // Keep secrets out of HTTP requests, referrers and subsequent history entries.
      clearFragment();
    };
    if (!initialized.current) {
      initialized.current = true;
      // Initial state already captured this link; keep its form mounted.
      if (window.location.hash) clearFragment();
    } else consume();
    // Native same-document links and React Router navigations both need handling.
    window.addEventListener('hashchange', consume);
    return () => window.removeEventListener('hashchange', consume);
  }, [location.key, location.hash]);
  return link;
}
