import type { MarketAsset, QuoteDto } from '@marketpulse/contracts';
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
) {
  const text = query.trim().toLowerCase();
  return assets
    .filter(
      (asset) =>
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
