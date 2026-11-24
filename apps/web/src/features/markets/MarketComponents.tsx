import { Link } from 'react-router';
import type {
  MarketAsset,
  QuoteDto,
  MarketStatus,
} from '@marketpulse/contracts';
import {
  change,
  money,
  observed,
  quoteStatus,
  marketReason,
} from './presentation';

export function DataLabel({ simulated }: { simulated: boolean }) {
  return (
    <span className={`data-label ${simulated ? 'is-demo' : 'is-real'}`}>
      {simulated ? 'Simulated data' : 'Real market data'}
    </span>
  );
}
export function QuoteNotice({ quote }: { quote?: QuoteDto }) {
  const state = quoteStatus(quote);
  if (state === 'fresh' && !quote?.reason) return null;
  return (
    <p className="quote-notice">
      {marketReason(
        quote?.reason ??
          (state === 'stale' ? 'stale_observation' : 'not_cached'),
      )}
      {quote &&
        !quote.simulated &&
        state === 'unavailable' &&
        ' No simulated replacement is shown.'}
    </p>
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
      {(quote || asset.type === 'STOCK') && (
        <DataLabel simulated={quote?.simulated ?? true} />
      )}
      <p className="price-meta">
        {quote?.provider ?? 'Source pending'} ·{' '}
        <span className={`status-${status}`}>{status}</span>
        <br />
        Observed {observed(quote?.sourceAt)}
      </p>
      <QuoteNotice quote={quote} />
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
export function MarketLoading({
  refreshing = false,
}: {
  refreshing?: boolean;
}) {
  return (
    <div
      className={`market-loading${refreshing ? ' is-refreshing' : ''}`}
      role="status"
    >
      <span className="loading-bar" aria-hidden="true" />
      {refreshing
        ? 'Refreshing cached observations…'
        : 'Loading the latest cached observations…'}
    </div>
  );
}
export function MarketPolicy(_props: {
  cryptoMode: string;
  cryptoSeconds: number;
  workerEnabled: boolean;
  providers?: MarketStatus['providers'];
}) {
  void _props;
  return (
    <aside className="market-policy" aria-label="Market data information">
      <div>
        <strong>Market data information.</strong>
        <p>
          Native prices and price alerts are currently unavailable. Charts are
          informational; check the provider's source, observation time and delay
          indicators. Data may be delayed or unavailable and is not investment
          advice.
        </p>
      </div>
    </aside>
  );
}
export function MarketSourcePolicy({
  status,
}: {
  status: MarketStatus | null;
}) {
  return (
    <MarketPolicy
      cryptoMode={status?.cryptoMode ?? ''}
      cryptoSeconds={0}
      workerEnabled={false}
    />
  );
}
