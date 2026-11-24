import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { TradingViewWidget } from '../src/features/markets/TradingViewWidget';
import {
  overviewSymbols,
  tradingViewSymbol,
  tradingViewLink,
  widgetConfig,
} from '../src/features/markets/tradingview';

test('all fifteen catalog symbols map to explicit USD display instruments', () => {
  for (const symbol of [
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
  ]) {
    assert.equal(
      tradingViewSymbol({
        type: 'CRYPTO',
        symbol,
        exchange: null,
        quoteCurrency: 'USD',
      }),
      `COINBASE:${symbol}USD`,
    );
  }
  for (const symbol of ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'NVDA']) {
    assert.equal(
      tradingViewSymbol({
        type: 'STOCK',
        symbol,
        exchange: 'NASDAQ',
        quoteCurrency: 'USD',
      }),
      `NASDAQ:${symbol}`,
    );
    assert.equal(
      tradingViewSymbol({
        type: 'STOCK',
        symbol,
        exchange: 'NYSE',
        quoteCurrency: 'USD',
      }),
      null,
    );
  }
  assert.equal(new Set(overviewSymbols).size, 15);
  assert.equal(
    tradingViewSymbol({
      type: 'CRYPTO',
      symbol: 'UNKNOWN',
      exchange: null,
      quoteCurrency: 'USD',
    }),
    null,
  );
});
test('widget configuration pins instruments and does not turn widgets into native data APIs', () => {
  assert.throws(() => widgetConfig('EVIL:<script>', 'dark'), /Unsupported/);
  const chart = widgetConfig('NASDAQ:AAPL', 'light');
  assert.equal(chart.theme, 'light');
  assert.equal(chart.allow_symbol_change, false);
  assert.equal(widgetConfig(undefined, 'dark').tabs?.length, 2);
  assert.equal(
    tradingViewLink('NASDAQ:AAPL'),
    'https://www.tradingview.com/symbols/NASDAQ-AAPL/',
  );
});
test('display preserves attribution, loading state and accurate limitations before external script loads', () => {
  const html = renderToStaticMarkup(
    <TradingViewWidget symbol="NASDAQ:AAPL" name="Apple" />,
  );
  assert.match(html, /Loading TradingView/);
  assert.match(html, /by TradingView/);
  assert.match(html, /noopener nofollow noreferrer/);
  assert.match(html, /delayed or alternative/);
  assert.match(html, /not used for MarketPulse price alerts/);
  assert.doesNotMatch(html, /Simulated|105\.00|7999|API key/);
});
