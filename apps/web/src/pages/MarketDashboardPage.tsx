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
      <div className="dashboard-chart-section">
        <div className="dashboard-section-intro">
          <p className="eyebrow">The bigger picture</p>
          <p>Market trends, directly from the source.</p>
        </div>
        <TradingViewWidget />
      </div>
      {loading && <MarketLoading refreshing={!!data} />}
      {error && <ResourceError message={error} retry={retry} />}
      {data && (
        <>
          <MarketSourcePolicy status={data.status} />
          <section
            className="market-panel catalog-panel"
            aria-labelledby="catalog-heading"
          >
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
              <ul className="asset-catalog-grid" aria-label="Asset catalog">
                {assets.map((asset) => {
                  const symbol = tradingViewSymbol(asset);
                  return (
                    <li key={asset.id} className="asset-catalog-card">
                      <div className="asset-card-heading">
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
                              {asset.symbol} · {asset.exchange ?? 'Crypto'}
                            </span>
                          </span>
                        </Link>
                        <FavoriteButton
                          name={asset.name}
                          selected={favorites.includes(asset.key)}
                          onToggle={() => toggle(asset.key)}
                        />
                      </div>
                      <div className="asset-card-meta">
                        <span className="asset-type-label">
                          {asset.type === 'STOCK' ? 'Stock' : 'Cryptocurrency'}
                        </span>
                        <span>
                          {symbol
                            ? 'TradingView display'
                            : 'Display unavailable'}
                        </span>
                      </div>
                      <p className="asset-card-description">
                        {symbol
                          ? 'Explore interactive price history and market context.'
                          : 'A market display is not currently available for this asset.'}
                      </p>
                      <Link
                        className="asset-chart-link"
                        to={`/assets/${asset.id}`}
                      >
                        {symbol
                          ? 'View interactive chart'
                          : 'View asset details'}
                        <span aria-hidden="true">↗</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
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
