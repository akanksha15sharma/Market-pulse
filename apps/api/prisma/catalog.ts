// Provider IDs are identifiers only. No quotes or external datasets are seeded.
export const cryptoCatalog = [
  ['bitcoin', 'BTC', 'Bitcoin'],
  ['ethereum', 'ETH', 'Ethereum'],
  ['solana', 'SOL', 'Solana'],
  ['ripple', 'XRP', 'XRP'],
  ['cardano', 'ADA', 'Cardano'],
  ['dogecoin', 'DOGE', 'Dogecoin'],
  ['avalanche-2', 'AVAX', 'Avalanche'],
  ['chainlink', 'LINK', 'Chainlink'],
  ['litecoin', 'LTC', 'Litecoin'],
  ['polkadot', 'DOT', 'Polkadot'],
] as const;

export const stockCatalog = [
  ['AAPL', 'Apple'],
  ['MSFT', 'Microsoft'],
  ['AMZN', 'Amazon'],
  ['GOOGL', 'Alphabet'],
  ['NVDA', 'NVIDIA'],
] as const;

// Preserve canonical keys/UUIDs; these IDs belong exclusively to CoinPaprika.
export const coinPaprikaIds: Record<(typeof cryptoCatalog)[number][0], string> =
  {
    bitcoin: 'btc-bitcoin',
    ethereum: 'eth-ethereum',
    solana: 'sol-solana',
    ripple: 'xrp-xrp',
    cardano: 'ada-cardano',
    dogecoin: 'doge-dogecoin',
    'avalanche-2': 'avax-avalanche',
    chainlink: 'link-chainlink',
    litecoin: 'ltc-litecoin',
    polkadot: 'dot-polkadot',
  };
