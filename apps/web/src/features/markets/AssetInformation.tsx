import type { HistoryRange, MarketAsset } from '@marketpulse/contracts';

import { historyRanges } from './presentation';

export function HistoryRangeFilters({
  range,
  onChange,
}: {
  range: HistoryRange;
  onChange: (range: HistoryRange) => void;
}) {
  return (
    <div
      className="market-tabs range-tabs"
      role="group"
      aria-label="Historical range"
    >
      {historyRanges.map(({ value, label }) => (
        <button
          type="button"
          key={value}
          aria-pressed={range === value}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function AssetInformation({ asset }: { asset: MarketAsset }) {
  return (
    <section
      className="market-panel"
      aria-labelledby="asset-information-heading"
    >
      <div className="panel-heading">
        <div>
          <h2 id="asset-information-heading">About {asset.name}</h2>
          <p>Asset information from the market catalog.</p>
        </div>
      </div>
      <dl className="asset-information">
        <div>
          <dt>Symbol</dt>
          <dd>{asset.symbol}</dd>
        </div>
        <div>
          <dt>Asset type</dt>
          <dd>{asset.type === 'STOCK' ? 'Stock' : 'Cryptocurrency'}</dd>
        </div>
        <div>
          <dt>Market / exchange</dt>
          <dd>{asset.exchange ?? 'Crypto market'}</dd>
        </div>
        <div>
          <dt>Quote currency</dt>
          <dd>{asset.quoteCurrency}</dd>
        </div>
        <div>
          <dt>Data availability</dt>
          <dd>Provider chart; availability and delays vary by instrument</dd>
        </div>
      </dl>
    </section>
  );
}
