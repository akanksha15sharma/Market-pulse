import { Link } from 'react-router';
import type { MarketAsset, QuoteDto } from '@marketpulse/contracts';
import { change, money, observed, quoteStatus } from './presentation';

export function DataLabel({ simulated }: { simulated: boolean }) {
  return (
    <span className={`data-label ${simulated ? 'is-demo' : 'is-real'}`}>
      {simulated ? 'Simulated data' : 'Real market data'}
    </span>
  );
}
export function QuoteCard({
  asset,
  quote,
}: {
  asset: MarketAsset;
  quote?: QuoteDto;
}) {
  const status = quoteStatus(quote);
  return (
    <Link className="price-card" to={`/assets/${asset.id}`}>
      <div className="price-card-top">
        <span className="asset-mark" aria-hidden="true">
          {asset.symbol.slice(0, 2)}
        </span>
        <span>
          <strong>{asset.name}</strong>
          <span className="muted block">
            {asset.symbol} · {asset.type === 'STOCK' ? 'Stock' : 'Crypto'}
          </span>
        </span>
      </div>
      <div className="card-price">{money(quote?.price)}</div>
      <div
        className={`price-change ${quote?.changePercent != null && Number(quote.changePercent) < 0 ? 'negative' : 'positive'}`}
      >
        {change(quote?.changePercent)} <span className="muted">24h</span>
      </div>
      {quote && <DataLabel simulated={quote.simulated} />}
      <p className="price-meta">
        {quote?.provider ?? 'Source pending'} ·{' '}
        <span className={`status-${status}`}>{status}</span>
        <br />
        Observed {observed(quote?.sourceAt)}
      </p>
    </Link>
  );
}
export function ResourceError({
  message,
  retry,
}: {
  message: string;
  retry: () => void;
}) {
  return (
    <div role="alert" className="market-error">
      <div>
        <p>{message}</p>
        <p className="source-name">
          Any displayed observations may be out of date.
        </p>
      </div>
      <button className="secondary-button" onClick={retry}>
        Try again
      </button>
    </div>
  );
}
export function MarketLoading() {
  return (
    <div className="market-loading" role="status">
      <span className="loading-bar" />
      Loading the latest cached observations…
    </div>
  );
}
export function MarketPolicy({
  cryptoMode,
  cryptoSeconds,
  workerEnabled,
}: {
  cryptoMode: string;
  cryptoSeconds: number;
  workerEnabled: boolean;
}) {
  return (
    <aside
      className="market-policy"
      aria-label="Data sources and refresh policy"
    >
      <span className="policy-icon" aria-hidden="true">
        i
      </span>
      <div>
        <strong>Know your data.</strong> Stocks always use simulated stock data.{' '}
        {cryptoMode === 'demo' ? (
          'Crypto prices are also simulated.'
        ) : (
          <>
            Real crypto observations are provided by{' '}
            <a
              href="https://www.coingecko.com/"
              target="_blank"
              rel="noreferrer"
            >
              CoinGecko
            </a>
            .
          </>
        )}
        <p>
          Browser checks cached prices every 60 seconds while visible. Crypto
          source refresh: {cryptoSeconds / 60} min; simulated stocks: 1 min.{' '}
          {workerEnabled
            ? 'Updates depend on the backend worker running.'
            : 'The market worker is disabled; cached observations may become stale.'}
        </p>
      </div>
    </aside>
  );
}
