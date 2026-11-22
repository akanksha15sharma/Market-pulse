-- Preserve legacy events as explicitly unverified; new events carry immutable observations/targets.
ALTER TABLE alert_events
  ADD COLUMN "targetPrice" numeric(38,18),
  ADD COLUMN direction "AlertDirection",
  ADD COLUMN provider "Provider",
  ADD COLUMN mode "DataMode",
  ADD COLUMN "fetchedAt" timestamptz(3);
ALTER TABLE alert_events ADD CONSTRAINT alert_events_real_provenance CHECK (
  ("targetPrice" IS NULL AND direction IS NULL AND provider IS NULL AND mode IS NULL AND "fetchedAt" IS NULL)
  OR
  ("targetPrice" IS NOT NULL AND direction IS NOT NULL AND provider IS NOT NULL AND mode IS NOT NULL AND "fetchedAt" IS NOT NULL
   AND "targetPrice" > 0 AND provider = 'COINPAPRIKA' AND mode = 'REAL'
   AND ((direction = 'ABOVE' AND "observedPrice" >= "targetPrice") OR (direction = 'BELOW' AND "observedPrice" <= "targetPrice"))
   AND "sourceAt" <= "fetchedAt" AND "fetchedAt" <= "triggeredAt"
   AND "sourceAt" >= "triggeredAt" - interval '20 minutes'
   AND "fetchedAt" >= "triggeredAt" - interval '20 minutes')
);
