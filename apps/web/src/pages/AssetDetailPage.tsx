import { lazy, Suspense, useCallback, useState } from 'react';
import { Link, useParams } from 'react-router';
import { z } from 'zod';
import { historyRangeSchema, type HistoryRange } from '@marketpulse/contracts';
import {
  historyInterval,
  loadAsset,
  loadHistory,
} from '../features/markets/api';
import { useMarketResource } from '../features/markets/use-market-resource';
const HistoryChart = lazy(() =>
  import('../features/markets/HistoryChart').then((module) => ({
    default: module.HistoryChart,
  })),
);
import {
  DataLabel,
  QuoteNotice,
  MarketLoading,
  MarketPolicy,
  ResourceError,
} from '../features/markets/MarketComponents';
import {
  change,
  money,
  observed,
  quoteStatus,
} from '../features/markets/presentation';

export function AssetDetailPage() {
  const { id = '' } = useParams();
  if (!z.uuid().safeParse(id).success)
    return (
      <section className="catalog-empty">
        <h1>Asset not found</h1>
        <p>Choose an asset from the curated market catalog.</p>
        <Link to="/markets" className="secondary-button">
          Explore markets
        </Link>
      </section>
    );
  return <AssetDetail key={id} id={id} />;
}
function AssetDetail({ id }: { id: string }) {
  const [range, setRange] = useState<HistoryRange>('1D');
  const request = useCallback(
    (signal: AbortSignal) => loadAsset(id, signal),
    [id],
  );
  const asset = useMarketResource(request);
  // History is mounted only after the catalog confirms that this asset exists.
  return (
    <div className="asset-detail">
      <Link className="back-link" to="/markets">
        All markets
      </Link>
      {asset.loading && <MarketLoading />}
      {asset.error && (
        <ResourceError message={asset.error} retry={asset.retry} />
      )}
      {asset.data && (
        <>
          <div className="market-heading">
            <div>
              <p className="eyebrow">
                {asset.data.asset.type === 'STOCK'
                  ? 'Stock · Simulated stock data'
                  : 'Cryptocurrency'}{' '}
                · USD
              </p>
              <h1>
                {asset.data.asset.name}{' '}
                <span className="asset-symbol">{asset.data.asset.symbol}</span>
              </h1>
              <p className="market-subtitle">
                {asset.data.asset.exchange ?? 'Crypto market'} · Historical
                price observations
              </p>
            </div>
            {asset.data.quote && (
              <DataLabel simulated={asset.data.quote.simulated} />
            )}
          </div>
          <section className="asset-price-panel" aria-label="Current price">
            <div>
              <span className="eyebrow">Latest cached price</span>
              <p className="detail-price">{money(asset.data.quote?.price)}</p>
            </div>
            <div>
              <span className="eyebrow">24h change</span>
              <p
                className={`detail-change ${asset.data.quote?.changePercent != null && Number(asset.data.quote.changePercent) < 0 ? 'negative' : 'positive'}`}
              >
                {change(asset.data.quote?.changePercent)}
              </p>
            </div>
            <div className="observation-meta">
              <strong className={`status-${quoteStatus(asset.data.quote)}`}>
                {quoteStatus(asset.data.quote)}
              </strong>
              <p>
                {asset.data.quote?.provider ?? 'Source pending'} · Observed{' '}
                {observed(asset.data.quote?.sourceAt)}
              </p>
              <p>Cache fetched {observed(asset.data.quote?.fetchedAt)}</p>
              <QuoteNotice quote={asset.data.quote} />
            </div>
          </section>
          <section className="market-panel" aria-labelledby="history-heading">
            <div className="panel-heading">
              <div>
                <h2 id="history-heading">Price history</h2>
                <p>Explore observations, one point at a time.</p>
              </div>
              <div
                className="market-tabs range-tabs"
                role="group"
                aria-label="Historical range"
              >
                {historyRangeSchema.options.map((value) => (
                  <button
                    key={value}
                    aria-pressed={range === value}
                    onClick={() => setRange(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
            <AssetHistory
              key={`${range}:${asset.data.status.cryptoMode}`}
              expectedProvider={
                asset.data.asset.type === 'CRYPTO' &&
                asset.data.status.cryptoMode === 'coinpaprika'
                  ? 'COINPAPRIKA'
                  : 'DEMO'
              }
              id={id}
              range={range}
              name={asset.data.asset.name}
            />
          </section>
          <MarketPolicy
            cryptoMode={asset.data.status.cryptoMode}
            cryptoSeconds={asset.data.status.refreshSeconds.crypto}
            workerEnabled={asset.data.status.workerEnabled}
            providers={asset.data.status.providers}
          />
        </>
      )}
    </div>
  );
}
function AssetHistory({
  id,
  range,
  name,
  expectedProvider,
}: {
  expectedProvider: 'DEMO' | 'COINPAPRIKA';
  id: string;
  range: HistoryRange;
  name: string;
}) {
  const request = useCallback(
    (signal: AbortSignal) => loadHistory(id, range, signal, expectedProvider),
    [id, range, expectedProvider],
  );
  const { data, loading, error, retry } = useMarketResource(
    request,
    historyInterval,
  );
  return (
    <>
      {loading && <MarketLoading />}
      {error && <ResourceError message={error} retry={retry} />}
      {data && (
        <Suspense fallback={<MarketLoading />}>
          <HistoryChart history={data} name={name} />
        </Suspense>
      )}
    </>
  );
}
