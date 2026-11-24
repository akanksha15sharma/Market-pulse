import { useCallback } from 'react';
import { Link, useParams } from 'react-router';
import { z } from 'zod';
import { loadAsset } from '../features/markets/api';
import { AssetInformation } from '../features/markets/AssetInformation';
import { useMarketResource } from '../features/markets/use-market-resource';
import {
  MarketLoading,
  ResourceError,
  MarketSourcePolicy,
} from '../features/markets/MarketComponents';
import { TradingViewWidget } from '../features/markets/TradingViewWidget';
import { tradingViewSymbol } from '../features/markets/tradingview';

export function AssetDetailPage() {
  const { id = '' } = useParams();
  if (!z.uuid().safeParse(id).success)
    return (
      <section className="catalog-empty">
        <h1>Asset not found</h1>
        <p>Choose an asset from the curated market catalog.</p>
        <Link to="/markets">Explore markets</Link>
      </section>
    );
  return <AssetDetail key={id} id={id} />;
}
function AssetDetail({ id }: { id: string }) {
  const request = useCallback(
    (signal: AbortSignal) => loadAsset(id, signal),
    [id],
  );
  const { data, loading, error, retry } = useMarketResource(request);
  const symbol = data ? tradingViewSymbol(data.asset) : null;
  return (
    <div className="asset-detail">
      <Link className="back-link" to="/markets">
        All markets
      </Link>
      {loading && <MarketLoading refreshing={!!data} />}
      {error && <ResourceError message={error} retry={retry} />}
      {data && (
        <>
          <div className="market-heading">
            <div>
              <p className="eyebrow">
                {data.asset.type === 'STOCK' ? 'Stock' : 'Cryptocurrency'} · USD
              </p>
              <h1>
                {data.asset.name}{' '}
                <span className="asset-symbol">{data.asset.symbol}</span>
              </h1>
              <p className="market-subtitle">
                Explore price history with TradingView's interactive chart.
              </p>
            </div>
          </div>
          {symbol ? (
            <TradingViewWidget symbol={symbol} name={data.asset.name} />
          ) : (
            <section className="catalog-empty">
              <h2>Market display unavailable</h2>
              <p>
                This instrument does not yet have a verified display mapping.
                Your saved asset is preserved.
              </p>
            </section>
          )}
          <AssetInformation asset={data.asset} />
          <MarketSourcePolicy status={data.status} />
        </>
      )}
    </div>
  );
}
