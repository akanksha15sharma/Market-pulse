import type {
  MarketAsset,
  QuoteDto,
  WatchlistView,
} from '@marketpulse/contracts';
import { Link } from 'react-router';
import { DataLabel, QuoteNotice } from '../markets/MarketComponents';
import { change, money, observed, quoteStatus } from '../markets/presentation';

export function WatchlistAssets({
  items,
  quotes,
  disabled,
  remove,
}: {
  items: WatchlistView['items'];
  quotes: QuoteDto[];
  disabled: boolean;
  remove: (asset: MarketAsset) => React.ReactNode;
}) {
  if (!items.length)
    return (
      <div className="catalog-empty">
        <h3>Your next perspective starts here.</h3>
        <p>
          Add crypto or stocks from the catalog below. Your choices are saved
          privately to your account.
        </p>
      </div>
    );
  return (
    <div
      className="watchlist-saved-assets"
      role="region"
      aria-label="Saved asset prices"
      tabIndex={0}
    >
      <ul className="saved-asset-list">
        {items.map(({ asset, available }) => {
          const quote = available
            ? quotes.find((value) => value.assetId === asset.id)
            : undefined;
          return (
            <li key={asset.id} className="saved-asset-card">
              <div className="saved-asset-heading">
                {available ? (
                  <Link className="asset-link" to={`/assets/${asset.id}`}>
                    <span
                      className={`asset-mark ${asset.type === 'STOCK' ? 'stock-mark' : ''}`}
                      aria-hidden="true"
                    >
                      {asset.symbol.slice(0, 2)}
                    </span>
                    <span>
                      <strong>{asset.name}</strong>
                      <span className="muted block">
                        {asset.symbol} ·{' '}
                        {asset.type === 'STOCK' ? 'Stock' : 'Crypto'}
                      </span>
                    </span>
                  </Link>
                ) : (
                  <span>
                    <strong>{asset.name}</strong>
                    <span className="muted block">
                      {asset.symbol} · No longer in the active catalog
                    </span>
                  </span>
                )}
              </div>
              <div className="saved-asset-observation numeric">
                <span className="saved-asset-label">Price / 24h</span>
                {money(quote?.price)}
                <span
                  className={`block source-name ${quote?.changePercent == null ? 'muted' : Number(quote.changePercent) < 0 ? 'negative' : 'positive'}`}
                >
                  {change(quote?.changePercent)}
                </span>
              </div>
              <div className="saved-asset-source">
                {quote ? (
                  <>
                    <DataLabel simulated={quote.simulated} />
                    <span className="source-name block muted">
                      {quote.provider} ·{' '}
                      <span className={`status-${quoteStatus(quote)}`}>
                        {quoteStatus(quote)}
                      </span>
                    </span>
                    <span className="source-name block muted">
                      {observed(quote.sourceAt)}
                    </span>
                    <QuoteNotice quote={quote} />
                  </>
                ) : (
                  <>
                    <span className="muted">Price unavailable</span>
                    {available && (
                      <Link
                        className="source-name block"
                        to={`/assets/${asset.id}`}
                      >
                        Open market chart
                      </Link>
                    )}
                  </>
                )}
              </div>
              <div className="saved-asset-actions" aria-disabled={disabled}>
                {remove(asset)}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
