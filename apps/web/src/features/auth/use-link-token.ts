import { useEffect, useState } from 'react';
export function useLinkToken() {
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '',
  );
  useEffect(() => {
    // Tokens stay out of HTTP requests, referrers and subsequent browser history entries.
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + window.location.search,
    );
  }, []);
  return token;
}
