import { Link, useSearchParams } from 'react-router';
import { loadOverview } from '../features/markets/api';
import { useMarketResource } from '../features/markets/use-market-resource';
import {
  DataLabel,
  MarketLoading,
  MarketSourcePolicy,
  QuoteCard,
  QuoteNotice,
  ResourceError,
} from '../features/markets/MarketComponents';
import {
  change,
  filterAssets,
  money,
  observed,
  quoteStatus,
} from '../features/markets/presentation';

export function MarketDashboardPage() {
  const { data, error, loading, retry, checkedAt } =
    useMarketResource(loadOverview);
  const [params, setParams] = useSearchParams();
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
  const assets = filterAssets(data?.assets ?? [], query, type, sort);
  const featured =
    data?.assets.filter((asset) =>
      ['BTC', 'ETH', 'SOL', 'AAPL'].includes(asset.symbol),
    ) ?? [];
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
          Curated catalog<span>10 crypto · 5 simulated stocks</span>
        </span>
      </div>
      {loading && <MarketLoading />}
      {error && <ResourceError message={error} retry={retry} />}
      {data && (
        <>
          <MarketSourcePolicy status={data.status} />
          <p className="price-meta" role="status">
            Last checked: {observed(checkedAt)} · Auto-refresh every 60 seconds
            while visible. Prices were last updated at the observation times
            shown below.
          </p>
          <section aria-labelledby="snapshot-heading">
            <div className="section-heading">
              <h2 id="snapshot-heading">Market snapshot</h2>
              <span>24-hour price change</span>
            </div>
            <div className="price-cards">
              {featured.map((asset) => (
                <QuoteCard
                  key={asset.id}
                  asset={asset}
                  quote={data.quotes.find(
                    (quote) => quote.assetId === asset.id,
                  )}
                />
              ))}
            </div>
          </section>
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
              <div className="market-table-scroll">
                <table className="market-table">
                  <caption className="sr-only">
                    Market prices in USD. Select an asset to explore price
                    history.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Asset</th>
                      <th scope="col">Price</th>
                      <th scope="col">24h change</th>
                      <th scope="col">Data source</th>
                      <th scope="col">Observation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assets.map((asset) => {
                      const quote = data.quotes.find(
                        (value) => value.assetId === asset.id,
                      );
                      const state = quoteStatus(quote);
                      return (
                        <tr key={asset.id}>
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
                          <td className="numeric">{money(quote?.price)}</td>
                          <td
                            className={`numeric ${quote?.changePercent != null && Number(quote.changePercent) < 0 ? 'negative' : 'positive'}`}
                          >
                            {change(quote?.changePercent)}
                          </td>
                          <td>
                            {quote ? (
                              <>
                                <DataLabel simulated={quote.simulated} />
                                <span className="muted block source-name">
                                  {quote.provider}
                                </span>
                              </>
                            ) : asset.type === 'STOCK' ? (
                              <DataLabel simulated />
                            ) : (
                              'Source pending'
                            )}
                          </td>
                          <td>
                            <span className={`status-${state}`}>{state}</span>
                            <span className="muted block source-name">
                              Last updated {observed(quote?.sourceAt)}
                            </span>
                            <QuoteNotice quote={quote} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="catalog-empty">
                <h3>No matching assets</h3>
                <p>
                  Search the curated catalog by name or symbol, or choose
                  another asset type.
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
              USD prices · No exchange tick feed · Select an asset for
              historical observations
            </div>
          </section>
        </>
      )}
    </div>
  );
}
