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
      className="market-table-scroll"
      role="region"
      aria-label="Saved asset prices"
      tabIndex={0}
    >
      <table className="market-table">
        <caption className="sr-only">
          Saved assets with current cached USD prices
        </caption>
        <thead>
          <tr>
            <th scope="col">Asset</th>
            <th scope="col">Price / 24h</th>
            <th scope="col">Source / observation</th>
            <th scope="col">Manage</th>
          </tr>
        </thead>
        <tbody>
          {items.map(({ asset, available }) => {
            const quote = available
              ? quotes.find((value) => value.assetId === asset.id)
              : undefined;
            return (
              <tr key={asset.id}>
                <th scope="row">
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
                </th>
                <td className="numeric">
                  {money(quote?.price)}
                  <span
                    className={`block source-name ${quote?.changePercent == null ? 'muted' : Number(quote.changePercent) < 0 ? 'negative' : 'positive'}`}
                  >
                    {change(quote?.changePercent)}
                  </span>
                </td>
                <td>
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
                </td>
                <td aria-disabled={disabled}>{remove(asset)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
