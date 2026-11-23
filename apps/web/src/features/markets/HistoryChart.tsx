import { memo, useId, useMemo, useState } from 'react';
import type { History } from './api';
import {
  chartPoints,
  change,
  historySummary,
  nearestObservation,
  money,
  observed,
  historyStatus,
  marketReason,
} from './presentation';
import { DataLabel } from './MarketComponents';

export function HistoryChart({
  history,
  name,
}: {
  history: History;
  name: string;
}) {
  const title = useId();
  const gradient = useId();
  const state = historyStatus(history);
  const points = useMemo(() => chartPoints(history), [history]);
  const geometry = useMemo(() => {
    if (!points.length) return null;
    const summary = historySummary(points)!;
    const minimum = summary.low;
    const maximum = summary.high;
    const padding = (maximum - minimum) * 0.12 || maximum * 0.01;
    const low = minimum - padding;
    const high = maximum + padding;
    const first = points[0]!.time;
    const last = points[points.length - 1]!.time;
    const x = (time: number) =>
      70 + ((time - first) / (last - first || 1)) * 850;
    const y = (value: number) => 30 + ((high - value) / (high - low)) * 230;
    const path = points
      .map(
        (point, index) =>
          `${index ? 'L' : 'M'}${x(point.time)},${y(point.value)}`,
      )
      .join(' ');
    return { summary, low, high, first, last, x, y, path };
  }, [points]);
  const [selected, setSelected] = useState<number | null>(null);
  const waiting =
    history.refresh === 'pending' &&
    (!history.reason || ['pending', 'busy'].includes(history.reason));
  if (state === 'unavailable' || !geometry)
    return (
      <div className="chart-empty" role="status">
        <DataLabel simulated={history.simulated} />
        <p>{history.provider} · unavailable</p>
        <strong>
          {waiting ? 'Preparing price history' : 'History unavailable'}
        </strong>
        <p>
          {waiting
            ? 'The backend has queued this range. We check again in 20 seconds while this tab is visible.'
            : 'No usable historical observations are cached for this range.'}
        </p>
        <p>{marketReason(history.reason)}</p>
        {!history.simulated && (
          <p>No simulated history is substituted for real crypto.</p>
        )}
      </div>
    );
  const currentIndex = Math.min(
    selected ?? points.length - 1,
    points.length - 1,
  );
  const current = points[currentIndex]!;
  const { summary, low, high, first, last, x, y, path } = geometry;

  return (
    <figure className="history-figure">
      <div className="chart-observation">
        <div>
          <span className="eyebrow">Selected observation</span>
          <output aria-live="polite">
            <strong>{money(current.price)}</strong>
            <span>{observed(current.timestamp)}</span>
          </output>
        </div>
        <DataLabel simulated={history.simulated} />
      </div>
      <svg
        className="history-chart"
        viewBox="0 0 950 300"
        role="img"
        aria-labelledby={title}
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          if (!rect.width) return;
          const position = ((event.clientX - rect.left) / rect.width) * 950;
          const time =
            first +
            Math.max(0, Math.min(1, (position - 70) / 850)) * (last - first);
          setSelected(nearestObservation(points, time));
        }}
      >
        <title
          id={title}
        >{`${name} historical USD prices. Use the observation slider or data table to explore exact values.`}</title>
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#2dd4bf" stopOpacity="0.22" />
            <stop offset="1" stopColor="#2dd4bf" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((tick) => {
          const value = low + ((high - low) * tick) / 3;
          return (
            <g key={tick}>
              <line
                x1="70"
                x2="920"
                y1={y(value)}
                y2={y(value)}
                stroke="#243345"
                strokeDasharray="4 5"
              />
              <text
                x="60"
                y={y(value) + 4}
                textAnchor="end"
                fill="#94a3b8"
                fontSize="12"
              >
                {new Intl.NumberFormat('en-US', {
                  notation: 'compact',
                  maximumSignificantDigits: 4,
                }).format(value)}
              </text>
            </g>
          );
        })}
        <path
          d={`${path} L${x(last)},260 L${x(first)},260 Z`}
          fill={`url(#${gradient})`}
        />
        <path
          d={path}
          fill="none"
          stroke="#2dd4bf"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={x(current.time)}
          x2={x(current.time)}
          y1="25"
          y2="260"
          stroke="#64748b"
          strokeDasharray="4 4"
        />
        <circle
          cx={x(current.time)}
          cy={y(current.value)}
          r="5"
          fill="#2dd4bf"
          stroke="#0b1220"
          strokeWidth="3"
        />
        <text x="70" y="289" fill="#94a3b8" fontSize="13">
          {new Date(first).toLocaleDateString()}
        </text>
        <text x="920" y="289" textAnchor="end" fill="#94a3b8" fontSize="13">
          {new Date(last).toLocaleDateString()}
        </text>
      </svg>
      <dl className="history-summary">
        <div>
          <dt>Range low</dt>
          <dd>{money(String(summary.low))}</dd>
        </div>
        <div>
          <dt>Range high</dt>
          <dd>{money(String(summary.high))}</dd>
        </div>
        <div>
          <dt>Range change</dt>
          <dd className={summary.changePercent < 0 ? 'negative' : 'positive'}>
            {change(String(summary.changePercent))}
          </dd>
        </div>
      </dl>
      <p className="quote-notice">
        Range statistics use the available observations. Coverage may be shorter
        than the selected range.
      </p>
      <label className="chart-slider-label">
        Explore observations
        <input
          className="chart-slider"
          type="range"
          min="0"
          max={points.length - 1}
          value={currentIndex}
          onChange={(event) => setSelected(Number(event.target.value))}
          aria-valuetext={`${observed(current.timestamp)}, ${money(current.price)}`}
        />
      </label>
      <figcaption>
        {history.provider} · <span className={`status-${state}`}>{state}</span>{' '}
        · {history.granularity} samples · Cache fetched{' '}
        {observed(history.fetchedAt)}.{' '}
        {history.refresh === 'pending' &&
          'A refresh is queued; cached history remains visible.'}
      </figcaption>
      <p className="quote-notice">
        Latest source observation{' '}
        {observed(history.sourceAt ?? points.at(-1)?.timestamp)}.{' '}
        {state === 'stale' &&
          marketReason(history.reason ?? 'stale_observation')}
      </p>
      {!history.simulated && (
        <p className="quote-notice">
          Powered by{' '}
          <a
            href="https://coinpaprika.com/api"
            target="_blank"
            rel="noreferrer"
          >
            CoinPaprika
          </a>
          .
        </p>
      )}
      <HistoryDataTable points={points} name={name} />
    </figure>
  );
}

const HistoryDataTable = memo(function HistoryDataTable({
  points,
  name,
}: {
  points: ReturnType<typeof chartPoints>;
  name: string;
}) {
  return (
    <details className="chart-data">
      <summary>View {points.length} observations as a table</summary>
      <div
        className="chart-data-scroll"
        role="region"
        aria-label={`${name} historical observations`}
        tabIndex={0}
      >
        <table>
          <caption className="sr-only">{name} history in USD</caption>
          <thead>
            <tr>
              <th scope="col">Observation time</th>
              <th scope="col">Price (USD)</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point, index) => (
              <tr key={`${point.timestamp}-${index}`}>
                <td>
                  <time dateTime={point.timestamp}>
                    {observed(point.timestamp)}
                  </time>
                </td>
                <td>{point.price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
});
