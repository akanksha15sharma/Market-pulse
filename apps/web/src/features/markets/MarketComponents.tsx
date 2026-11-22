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
      {quote && <DataLabel simulated={quote.simulated} />}
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
  providers,
}: {
  cryptoMode: string;
  cryptoSeconds: number;
  workerEnabled: boolean;
  providers?: MarketStatus['providers'];
}) {
  const live = providers?.find((provider) => provider.provider === 'COINGECKO');
  const monthly = live?.budgets.find(
    (budget) => budget.category === 'all:month',
  );
  const charts = live?.budgets.find(
    (budget) => budget.category === 'charts:day',
  );
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
            Data provided by{' '}
            <a
              href="https://www.coingecko.com/en/api"
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
        {cryptoMode === 'coingecko' && (
          <div className="live-feed-status" role="status">
            <strong>
              {live?.quoteReason
                ? 'Live crypto updates unavailable'
                : 'Real crypto mode selected'}
            </strong>
            {live?.quoteReason && (
              <p>
                {marketReason(live.quoteReason)} Prices retain their real source
                or stay unavailable.
              </p>
            )}
            {live?.historyReason && live.historyReason !== live.quoteReason && (
              <p>Historical charts: {marketReason(live.historyReason)}</p>
            )}
            <p>
              No silent fallback to simulated crypto. Stocks remain simulated.
            </p>
            {live?.lastSuccessAt && (
              <p>
                Last successful provider request: {observed(live.lastSuccessAt)}
              </p>
            )}
            {live?.blockedUntil && (
              <p>Provider pause until {observed(live.blockedUntil)}</p>
            )}
            {monthly && (
              <p>
                Application live request budget remaining this account window:{' '}
                {monthly.remaining}.{' '}
                {charts &&
                  `Chart requests remaining today: ${charts.remaining}.`}
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
