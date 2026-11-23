import {
  historySourceMaxAge,
  type MarketAsset,
  type HistoryRange,
  type QuoteDto,
} from '@marketpulse/contracts';
import type { History } from './api';

export function money(value: string | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return 'Unavailable';
  const price = Number(value);
  if (price > 0 && price < 0.00000001) return '< $0.00000001';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: price < 1 ? 8 : 2,
  }).format(price);
}
export function change(value: string | null | undefined) {
  if (value == null || !Number.isFinite(Number(value)))
    return 'Change unavailable';
  const number = Number(value);
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
}
export function observed(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        timeZoneName: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : 'No observation yet';
}
export function quoteStatus(quote: QuoteDto | undefined, now = Date.now()) {
  if (!quote || quote.status === 'unavailable' || !quote.sourceAt)
    return 'unavailable';
  const age = now - Date.parse(quote.sourceAt);
  return quote.status === 'stale' ||
    age > (quote.simulated ? 120_000 : 1_200_000) ||
    age < -60_000
    ? 'stale'
    : 'fresh';
}
export function filterAssets(
  assets: MarketAsset[],
  query: string,
  type: string,
  sort: string,
  favorites?: readonly string[],
) {
  const text = query.trim().toLowerCase();
  return assets
    .filter(
      (asset) =>
        (!favorites || favorites.includes(asset.key)) &&
        (type === 'ALL' || asset.type === type) &&
        `${asset.symbol} ${asset.name}`.toLowerCase().includes(text),
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : a.symbol.localeCompare(b.symbol),
    );
}
export function chartPoints(history: Pick<History, 'points'>) {
  return history.points
    .map((point) => ({
      ...point,
      time: Date.parse(point.timestamp),
      value: Number(point.price),
    }))
    .filter(
      (point) =>
        Number.isFinite(point.time) &&
        Number.isFinite(point.value) &&
        point.value > 0,
    )
    .sort((a, b) => a.time - b.time);
}

export function marketReason(reason: string | null | undefined) {
  const messages: Record<string, string> = {
    history_unavailable:
      'History is not available from the free public API for this asset or range.',
    quota_exhausted:
      'The provider budget is exhausted. Updates resume after its reset.',
    unauthorized:
      'The free public provider refused access. Live updates are paused.',
    rate_limited: 'CoinPaprika requested a pause before the next update.',
    network_error: 'CoinPaprika could not be reached.',
    upstream_error: 'CoinPaprika is temporarily unavailable.',
    invalid_data: 'The provider returned no usable observation.',
    not_cached: 'Waiting for the first cached observation.',
    pending: 'History is queued for background refresh.',
    stale_observation: 'The latest source observation is out of date.',
    source_not_enabled: 'This data source is no longer selected.',
    circuit_open:
      'Live updates are temporarily paused after provider failures.',
    busy: 'A shared refresh is already in progress.',
  };
  return reason
    ? (messages[reason] ?? 'The source is temporarily unavailable.')
    : '';
}
export function historyStatus(history: History, now = Date.now()) {
  if (
    !history.points.length ||
    history.status === 'unavailable' ||
    (history.expiresAt && Date.parse(history.expiresAt) <= now)
  )
    return 'unavailable';
  const latest = Math.max(
    ...history.points.map((point) => Date.parse(point.timestamp)),
  );
  if (
    history.status === 'stale' ||
    (history.freshUntil && Date.parse(history.freshUntil) <= now) ||
    !Number.isFinite(latest) ||
    latest > now + 60_000 ||
    now - latest > historySourceMaxAge(history.range, history.provider)
  )
    return 'stale';
  return 'fresh';
}

// chartPoints supplies observations sorted by time. Ties keep the first sample.
export function nearestObservation(
  points: readonly { time: number }[],
  time: number,
) {
  if (!points.length) return null;
  function lowerBound(target: number) {
    let low = 0;
    let high = points.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (points[middle]!.time < target) low = middle + 1;
      else high = middle;
    }
    return low;
  }
  const right = lowerBound(time);
  const index =
    right === 0
      ? 0
      : right === points.length
        ? right - 1
        : time - points[right - 1]!.time <= points[right]!.time - time
          ? right - 1
          : right;
  return lowerBound(points[index]!.time);
}

export function historySummary(points: { value: number }[]) {
  if (!points.length) return null;
  const first = points[0]!.value;
  const last = points.at(-1)!.value;
  return {
    low: Math.min(...points.map((point) => point.value)),
    high: Math.max(...points.map((point) => point.value)),
    changePercent: ((last - first) / first) * 100,
  };
}

export const historyRanges: { value: HistoryRange; label: string }[] = [
  { value: '1D', label: '24H' },
  { value: '7D', label: '7D' },
  { value: '1M', label: '30D' },
  { value: '1Y', label: '1Y' },
];
