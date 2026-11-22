-- Separate migration: the enum value must commit before it is used.
-- Only add provider mappings to existing canonical assets. Do not change asset IDs or prices.
INSERT INTO asset_provider_mappings (id, "assetId", provider, "providerAssetId")
SELECT gen_random_uuid(), a.id, 'COINPAPRIKA'::"Provider", v.external_id
FROM (VALUES
  ('crypto:bitcoin', 'btc-bitcoin'), ('crypto:ethereum', 'eth-ethereum'),
  ('crypto:solana', 'sol-solana'), ('crypto:ripple', 'xrp-xrp'),
  ('crypto:cardano', 'ada-cardano'), ('crypto:dogecoin', 'doge-dogecoin'),
  ('crypto:avalanche-2', 'avax-avalanche'), ('crypto:chainlink', 'link-chainlink'),
  ('crypto:litecoin', 'ltc-litecoin'), ('crypto:polkadot', 'dot-polkadot')
) AS v(asset_key, external_id)
JOIN assets a ON a.key = v.asset_key
ON CONFLICT ("assetId", provider) DO UPDATE SET "providerAssetId" = EXCLUDED."providerAssetId";
