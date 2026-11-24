import type { MarketAsset } from '@marketpulse/contracts';

// Explicit display mappings, never a native quote provider or an alert input.
const cryptoSymbols = new Set([
  'BTC',
  'ETH',
  'SOL',
  'XRP',
  'ADA',
  'DOGE',
  'AVAX',
  'LINK',
  'LTC',
  'DOT',
]);
const stockSymbols = new Set(['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'NVDA']);
export function tradingViewSymbol(
  asset: Pick<MarketAsset, 'type' | 'symbol' | 'exchange' | 'quoteCurrency'>,
): string | null {
  if (asset.quoteCurrency !== 'USD') return null;
  if (asset.type === 'CRYPTO' && cryptoSymbols.has(asset.symbol))
    return `COINBASE:${asset.symbol}USD`;
  if (
    asset.type === 'STOCK' &&
    asset.exchange === 'NASDAQ' &&
    stockSymbols.has(asset.symbol)
  )
    return `NASDAQ:${asset.symbol}`;
  return null;
}
export function tradingViewLink(symbol: string) {
  return `https://www.tradingview.com/symbols/${encodeURIComponent(symbol.replace(':', '-'))}/`;
}
export const overviewSymbols = [
  'NASDAQ:AAPL',
  'NASDAQ:MSFT',
  'NASDAQ:AMZN',
  'NASDAQ:GOOGL',
  'NASDAQ:NVDA',
  ...[...cryptoSymbols].map((symbol) => `COINBASE:${symbol}USD`),
];
export function widgetConfig(
  symbol: string | undefined,
  theme: 'dark' | 'light',
) {
  if (symbol && !overviewSymbols.includes(symbol))
    throw new Error('Unsupported display symbol');
  return symbol
    ? {
        autosize: true,
        symbol,
        interval: 'D',
        timezone: 'Etc/UTC',
        theme,
        style: '1',
        locale: 'en',
        allow_symbol_change: false,
        calendar: false,
        hide_side_toolbar: false,
        support_host: 'https://www.tradingview.com',
      }
    : {
        colorTheme: theme,
        dateRange: '12M',
        showChart: true,
        locale: 'en',
        width: '100%',
        height: '100%',
        isTransparent: false,
        tabs: [
          {
            title: 'Stocks',
            symbols: overviewSymbols
              .filter((value) => value.startsWith('NASDAQ:'))
              .map((s) => ({ s })),
          },
          {
            title: 'Crypto · USD',
            symbols: overviewSymbols
              .filter((value) => value.startsWith('COINBASE:'))
              .map((s) => ({ s })),
          },
        ],
      };
}
