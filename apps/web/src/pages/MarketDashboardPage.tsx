import { Link, useSearchParams } from 'react-router';
import { FavoriteButton } from '../features/markets/FavoriteButton';
import { useFavorites } from '../features/markets/favorites';
import { loadOverview } from '../features/markets/api';
import { useMarketResource } from '../features/markets/use-market-resource';
import {
  MarketLoading,
  MarketSourcePolicy,
  ResourceError,
} from '../features/markets/MarketComponents';
import { filterAssets } from '../features/markets/presentation';
import { TradingViewWidget } from '../features/markets/TradingViewWidget';
import { tradingViewSymbol } from '../features/markets/tradingview';

export function MarketDashboardPage() {
  const { data, error, loading, retry } = useMarketResource(loadOverview);
  const [params, setParams] = useSearchParams();
  const { favorites, toggle } = useFavorites();
  const favoritesOnly = params.get('favorites') === 'true';
  const query = params.get('q') ?? '';
  const type = ['CRYPTO', 'STOCK'].includes(params.get('type') ?? '')
    ? params.get('type')!
    : 'ALL';
  const sort = params.get('sort') === 'name' ? 'name' : 'symbol';
  const update = (key: string, value: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value && value !== 'ALL') next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const assets = filterAssets(
    data?.assets ?? [],
    query,
    type,
    sort,
    favoritesOnly ? favorites : undefined,
  );
  return (
    <div className="market-dashboard">
      <div className="market-heading">
        <div>
          <p className="eyebrow">Market overview · USD</p>
          <h1>Your market, in focus.</h1>
          <p className="market-subtitle">
            Explore crypto and stocks. See the source behind every price.
          </p>
        </div>
        <span className="catalog-chip">
          Curated catalog<span>10 cryptocurrencies · 5 stocks</span>
        </span>
      </div>
      <TradingViewWidget />
      {loading && <MarketLoading refreshing={!!data} />}
      {error && <ResourceError message={error} retry={retry} />}
      {data && (
        <>
          <MarketSourcePolicy status={data.status} />
          <section className="market-panel" aria-labelledby="catalog-heading">
            <div className="panel-heading">
              <div>
                <h2 id="catalog-heading">Explore markets</h2>
                <p>A focused catalog. A clearer perspective.</p>
              </div>
              <span className="muted">{data.assets.length} assets</span>
            </div>
            <div className="catalog-toolbar">
              <div className="market-tabs" role="group" aria-label="Asset type">
                {(
                  [
                    ['ALL', 'All assets'],
                    ['CRYPTO', 'Crypto'],
                    ['STOCK', 'Stocks'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    aria-pressed={type === value}
                    onClick={() => update('type', value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="market-tabs">
                <button
                  aria-pressed={favoritesOnly}
                  onClick={() =>
                    update('favorites', favoritesOnly ? '' : 'true')
                  }
                >
                  Favorites
                </button>
              </div>
              <label className="search-label">
                <span className="sr-only">
                  Search catalog by name or symbol
                </span>
                <input
                  type="search"
                  value={query}
                  maxLength={100}
                  onChange={(event) => update('q', event.target.value)}
                  placeholder="Search name or symbol"
                />
              </label>
              <label className="sort-label">
                <span className="sr-only">Sort assets</span>
                <select
                  value={sort}
                  onChange={(event) => update('sort', event.target.value)}
                >
                  <option value="symbol">Symbol A–Z</option>
                  <option value="name">Name A–Z</option>
                </select>
              </label>
            </div>
            <p className="catalog-results" role="status">
              {assets.length} {assets.length === 1 ? 'asset' : 'assets'}
              {query ? ` matching “${query}”` : ''}
            </p>
            {assets.length ? (
              <div
                className="market-table-scroll"
                role="region"
                aria-label="Market prices"
                tabIndex={0}
              >
                <table className="market-table">
                  <caption className="sr-only">
                    Market prices in USD. Select an asset to explore price
                    history.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">
                        <span className="sr-only">Favorite</span>
                      </th>
                      <th scope="col">Asset</th>
                      <th scope="col">Market display</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((asset) => {
                      return (
                        <tr key={asset.id}>
                          <td>
                            <FavoriteButton
                              name={asset.name}
                              selected={favorites.includes(asset.key)}
                              onToggle={() => toggle(asset.key)}
                            />
                          </td>
                          <th scope="row">
                            <Link
                              className="asset-link"
                              to={`/assets/${asset.id}`}
                            >
                              <span
                                className={`asset-mark ${asset.type === 'STOCK' ? 'stock-mark' : ''}`}
                                aria-hidden="true"
                              >
                                {asset.symbol.slice(0, 2)}
                              </span>
                              <span>
                                <strong>{asset.name}</strong>
                                <span className="muted block">
                                  {asset.symbol} · {asset.exchange ?? 'Crypto'}
                                </span>
                              </span>
                            </Link>
                          </th>
                          <td>
                            {tradingViewSymbol(asset) ? (
                              <Link to={`/assets/${asset.id}`}>
                                View interactive chart · TradingView
                              </Link>
                            ) : (
                              'Market display unavailable'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="catalog-empty">
                <h3>
                  {favoritesOnly
                    ? 'No matching favorites'
                    : 'No matching assets'}
                </h3>
                <p>
                  {favoritesOnly
                    ? 'Star assets in All assets to build your favorites, or clear filters to explore the catalog.'
                    : 'Search the curated catalog by name or symbol, or choose another asset type.'}
                </p>
                <button
                  className="secondary-button"
                  onClick={() => setParams({})}
                >
                  Clear filters
                </button>
              </div>
            )}
            <div className="panel-footnote">
              USD displays · Select an asset for interactive history ·
              Availability and delays vary by source
            </div>
          </section>
        </>
      )}
    </div>
  );
}
