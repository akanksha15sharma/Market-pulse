-- Add a window to the historical key so overlapping chart ranges refresh independently.
ALTER TABLE "historical_bars" ADD COLUMN "range" VARCHAR(2) NOT NULL DEFAULT '1D';
ALTER TABLE "historical_bars" DROP CONSTRAINT "historical_bars_pkey";
ALTER TABLE "historical_bars" ADD CONSTRAINT "historical_bars_pkey" PRIMARY KEY ("assetId", "provider", "mode", "currency", "range", "interval", "timestamp");
ALTER TABLE "historical_bars" ADD CONSTRAINT "historical_bars_range" CHECK ("range" IN ('1D','7D','1M','1Y'));
CREATE TABLE "history_caches" (
  "assetId" UUID NOT NULL,
  "provider" "Provider" NOT NULL,
  "mode" "DataMode" NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
  "range" VARCHAR(2) NOT NULL,
  "fetchedAt" TIMESTAMPTZ(3),
  "freshUntil" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3),
  "pending" BOOLEAN NOT NULL DEFAULT false,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" VARCHAR(50),
  CONSTRAINT "history_caches_pkey" PRIMARY KEY ("assetId", "provider", "mode", "currency", "range"),
  CONSTRAINT "history_caches_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "history_caches_range" CHECK ("range" IN ('1D','7D','1M','1Y')),
  CONSTRAINT "history_caches_usd" CHECK ("currency" = 'USD'),
  CONSTRAINT "history_caches_mode" CHECK (("provider" = 'DEMO') = ("mode" = 'DEMO'))
);
CREATE INDEX "history_caches_pending_nextAttemptAt_idx" ON "history_caches"("pending", "nextAttemptAt");
CREATE TRIGGER "history_caches_demo_mode" BEFORE INSERT OR UPDATE ON "history_caches" FOR EACH ROW EXECUTE FUNCTION enforce_demo_asset_mode();
CREATE TABLE "market_provider_states" (
  "provider" "Provider" NOT NULL PRIMARY KEY,
  "failures" INTEGER NOT NULL DEFAULT 0 CHECK ("failures" >= 0),
  "disabled" BOOLEAN NOT NULL DEFAULT false,
  "blockedUntil" TIMESTAMPTZ(3),
  "lastSuccessAt" TIMESTAMPTZ(3),
  "lastError" VARCHAR(50)
);
