import { useEffect, useRef, useState } from 'react';
import { tradingViewLink, widgetConfig } from './tradingview';
import { useMarketTheme } from './theme';

export function TradingViewWidget({
  symbol,
  name = 'Stock and cryptocurrency overview',
}: {
  symbol?: string;
  name?: string;
}) {
  const { theme } = useMarketTheme();
  const [attempt, setAttempt] = useState(0);
  return (
    <WidgetFrame
      key={`${symbol ?? 'overview'}:${theme}:${attempt}`}
      symbol={symbol}
      name={name}
      theme={theme}
      retry={() => setAttempt((value) => value + 1)}
    />
  );
}
function WidgetFrame({
  symbol,
  name,
  theme,
  retry,
}: {
  symbol?: string;
  name: string;
  theme: 'dark' | 'light';
  retry: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'embedded' | 'failed'>(
    'loading',
  );
  const href = symbol
    ? tradingViewLink(symbol)
    : 'https://www.tradingview.com/markets/';
  useEffect(() => {
    const container = host.current!;
    let disposed = false;
    const fail = () => {
      if (!disposed) setState('failed');
    };
    const timer = window.setTimeout(fail, 20_000);
    const frames = new WeakSet<HTMLIFrameElement>();
    const observer = new MutationObserver(() => {
      for (const frame of container.querySelectorAll('iframe')) {
        if (frames.has(frame)) continue;
        frames.add(frame);
        frame.title = `${name} — TradingView`;
        frame.addEventListener(
          'load',
          () => {
            if (disposed) return;
            clearTimeout(timer);
            setState('embedded');
          },
          { once: true },
        );
      }
    });
    observer.observe(container, { childList: true, subtree: true });
    const script = document.createElement('script');
    script.src = `https://s3.tradingview.com/external-embedding/embed-widget-${symbol ? 'advanced-chart' : 'market-overview'}.js`;
    script.type = 'text/javascript';
    script.async = true;
    script.textContent = JSON.stringify(widgetConfig(symbol, theme));
    script.onerror = fail;
    const content = document.createElement('div');
    content.className = 'tradingview-widget-container__widget';
    container.replaceChildren(content, script);
    return () => {
      disposed = true;
      clearTimeout(timer);
      observer.disconnect();
      container.replaceChildren();
    };
  }, [symbol, theme, name]);
  return (
    <section
      className="market-panel widget-panel"
      aria-label={`${name} market display`}
    >
      <h2>{name}</h2>
      {state === 'loading' && (
        <p role="status">Loading TradingView market display…</p>
      )}
      {state === 'failed' && (
        <div role="alert" className="market-error">
          <p>
            The market display could not be loaded. Your connection or privacy
            settings may block it.
          </p>
          <button className="secondary-button" onClick={retry}>
            Retry display
          </button>
        </div>
      )}
      <div className="market-widget-viewport">
        <div
          className="tradingview-widget-container"
          ref={host}
          aria-busy={state === 'loading'}
        />
      </div>
      <div className="tradingview-widget-copyright">
        <a href={href} target="_blank" rel="noopener nofollow noreferrer">
          <span className="blue-text">
            {symbol ? `${name} chart` : 'Track all markets'}
          </span>
        </a>
        <span className="trademark"> by TradingView</span>
      </div>
      <p className="price-meta">
        TradingView display · USD · Stocks may use delayed or alternative
        exchange feeds. Check the chart's source, timestamp and delay indicator.
        Crypto prices reflect Coinbase, not an all-exchange average. If a symbol
        is unavailable, use the provider link above.
      </p>
      <p className="price-meta">
        Charts load directly from TradingView, which receives your network
        information. Embedded data is not used for MarketPulse price alerts.
        Informational only; verify prices before making financial decisions.
      </p>
    </section>
  );
}
