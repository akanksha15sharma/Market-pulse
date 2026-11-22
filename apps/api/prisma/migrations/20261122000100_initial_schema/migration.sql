-- Initial MarketPulse PostgreSQL schema. UUIDs and updatedAt are assigned by Prisma.

CREATE TYPE "AssetType" AS ENUM ('CRYPTO', 'STOCK');

CREATE TYPE "DataMode" AS ENUM ('REAL', 'DEMO');

CREATE TYPE "Provider" AS ENUM ('COINGECKO', 'TWELVE_DATA', 'DEMO');

CREATE TYPE "TokenPurpose" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

CREATE TYPE "TradeSide" AS ENUM ('BUY', 'SELL');

CREATE TYPE "AlertDirection" AS ENUM ('ABOVE', 'BELOW');

CREATE TYPE "AlertStatus" AS ENUM ('ACTIVE', 'PAUSED', 'TRIGGERED');

CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'EXPIRED');

CREATE TABLE "users" (
  "id" UUID NOT NULL,
  "email" VARCHAR(254) NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "displayName" VARCHAR(100) NOT NULL,
  "emailVerifiedAt" TIMESTAMPTZ(3),
  "emailAlertsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" VARCHAR(128) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_tokens" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" VARCHAR(128) NOT NULL,
  "purpose" "TokenPurpose" NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assets" (
  "id" UUID NOT NULL,
  "key" VARCHAR(100) NOT NULL,
  "type" "AssetType" NOT NULL,
  "symbol" VARCHAR(20) NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "exchange" VARCHAR(50),
  "quoteCurrency" VARCHAR(3) NOT NULL DEFAULT 'USD',
  "isDemoOnly" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "asset_provider_mappings" (
  "id" UUID NOT NULL,
  "assetId" UUID NOT NULL,
  "provider" "Provider" NOT NULL,
  "providerAssetId" VARCHAR(100) NOT NULL,
  CONSTRAINT "asset_provider_mappings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "latest_quotes" (
  "assetId" UUID NOT NULL,
  "provider" "Provider" NOT NULL,
  "mode" "DataMode" NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
  "price" DECIMAL(38, 18) NOT NULL,
  "changePercent" DECIMAL(18, 8),
  "sourceAt" TIMESTAMPTZ(3) NOT NULL,
  "fetchedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "latest_quotes_pkey" PRIMARY KEY ("assetId", "provider", "mode", "currency")
);

CREATE TABLE "historical_bars" (
  "assetId" UUID NOT NULL,
  "provider" "Provider" NOT NULL,
  "mode" "DataMode" NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
  "interval" VARCHAR(10) NOT NULL,
  "timestamp" TIMESTAMPTZ(3) NOT NULL,
  "close" DECIMAL(38, 18) NOT NULL,
  "volume" DECIMAL(38, 18),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "historical_bars_pkey" PRIMARY KEY ("assetId", "provider", "mode", "currency", "interval", "timestamp")
);

CREATE TABLE "watchlists" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "watchlists_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "watchlist_items" (
  "watchlistId" UUID NOT NULL,
  "assetId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "watchlist_items_pkey" PRIMARY KEY ("watchlistId", "assetId")
);

CREATE TABLE "portfolios" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "mode" "DataMode" NOT NULL,
  "baseCurrency" VARCHAR(3) NOT NULL DEFAULT 'USD',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "transactions" (
  "id" UUID NOT NULL,
  "portfolioId" UUID NOT NULL,
  "assetId" UUID NOT NULL,
  "mode" "DataMode" NOT NULL,
  "side" "TradeSide" NOT NULL,
  "quantity" DECIMAL(38, 18) NOT NULL,
  "unitPrice" DECIMAL(38, 18) NOT NULL,
  "fee" DECIMAL(38, 18) NOT NULL DEFAULT 0,
  "executedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "price_alerts" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "assetId" UUID NOT NULL,
  "provider" "Provider" NOT NULL,
  "mode" "DataMode" NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
  "direction" "AlertDirection" NOT NULL,
  "threshold" DECIMAL(38, 18) NOT NULL,
  "status" "AlertStatus" NOT NULL DEFAULT 'ACTIVE',
  "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
  "activation" INTEGER NOT NULL DEFAULT 1,
  "armedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "price_alerts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "alert_events" (
  "id" UUID NOT NULL,
  "alertId" UUID NOT NULL,
  "activation" INTEGER NOT NULL,
  "observedPrice" DECIMAL(38, 18) NOT NULL,
  "sourceAt" TIMESTAMPTZ(3) NOT NULL,
  "triggeredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "alertEventId" UUID,
  "message" VARCHAR(1000) NOT NULL,
  "readAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "email_deliveries" (
  "id" UUID NOT NULL,
  "alertEventId" UUID NOT NULL,
  "recipient" VARCHAR(254) NOT NULL,
  "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "providerMessageId" VARCHAR(200),
  "nextRetryAt" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL,
  "type" VARCHAR(100) NOT NULL,
  "payload" JSONB NOT NULL,
  "processedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "provider_usage" (
  "provider" "Provider" NOT NULL,
  "category" VARCHAR(50) NOT NULL,
  "windowStart" TIMESTAMPTZ(3) NOT NULL,
  "windowEnd" TIMESTAMPTZ(3) NOT NULL,
  "reserved" INTEGER NOT NULL DEFAULT 0,
  "consumed" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "provider_usage_pkey" PRIMARY KEY ("provider", "category", "windowStart", "windowEnd")
);

CREATE TABLE "scheduler_leases" (
  "key" VARCHAR(150) NOT NULL,
  "owner" VARCHAR(100) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "scheduler_leases_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "users_email_key" ON "users" ("email");

CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions" ("tokenHash");

CREATE INDEX "sessions_userId_idx" ON "sessions" ("userId");

CREATE INDEX "sessions_expiresAt_idx" ON "sessions" ("expiresAt");

CREATE UNIQUE INDEX "auth_tokens_tokenHash_key" ON "auth_tokens" ("tokenHash");

CREATE INDEX "auth_tokens_userId_purpose_idx" ON "auth_tokens" ("userId", "purpose");

CREATE INDEX "auth_tokens_expiresAt_idx" ON "auth_tokens" ("expiresAt");

CREATE UNIQUE INDEX "assets_key_key" ON "assets" ("key");

CREATE INDEX "assets_type_isActive_idx" ON "assets" ("type", "isActive");

CREATE UNIQUE INDEX "asset_provider_mappings_provider_providerAssetId_key" ON "asset_provider_mappings" ("provider", "providerAssetId");

CREATE UNIQUE INDEX "asset_provider_mappings_assetId_provider_key" ON "asset_provider_mappings" ("assetId", "provider");

CREATE INDEX "historical_bars_expiresAt_idx" ON "historical_bars" ("expiresAt");

CREATE INDEX "watchlists_userId_idx" ON "watchlists" ("userId");

CREATE INDEX "watchlist_items_assetId_idx" ON "watchlist_items" ("assetId");

CREATE UNIQUE INDEX "portfolios_id_mode_key" ON "portfolios" ("id", "mode");

CREATE INDEX "portfolios_userId_idx" ON "portfolios" ("userId");

CREATE INDEX "transactions_portfolioId_executedAt_idx" ON "transactions" ("portfolioId", "executedAt");

CREATE INDEX "transactions_assetId_idx" ON "transactions" ("assetId");

CREATE INDEX "price_alerts_assetId_status_provider_mode_idx" ON "price_alerts" ("assetId", "status", "provider", "mode");

CREATE INDEX "price_alerts_userId_idx" ON "price_alerts" ("userId");

CREATE UNIQUE INDEX "alert_events_alertId_activation_key" ON "alert_events" ("alertId", "activation");

CREATE UNIQUE INDEX "notifications_userId_alertEventId_key" ON "notifications" ("userId", "alertEventId");

CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications" ("userId", "createdAt");

CREATE UNIQUE INDEX "email_deliveries_alertEventId_key" ON "email_deliveries" ("alertEventId");

CREATE INDEX "email_deliveries_status_nextRetryAt_idx" ON "email_deliveries" ("status", "nextRetryAt");

CREATE INDEX "outbox_events_processedAt_createdAt_idx" ON "outbox_events" ("processedAt", "createdAt");

CREATE INDEX "scheduler_leases_expiresAt_idx" ON "scheduler_leases" ("expiresAt");

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "asset_provider_mappings" ADD CONSTRAINT "asset_provider_mappings_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "latest_quotes" ADD CONSTRAINT "latest_quotes_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "historical_bars" ADD CONSTRAINT "historical_bars_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "watchlists" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_portfolioId_mode_fkey" FOREIGN KEY ("portfolioId", "mode") REFERENCES "portfolios" ("id", "mode") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "price_alerts" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_alertEventId_fkey" FOREIGN KEY ("alertEventId") REFERENCES "alert_events" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_alertEventId_fkey" FOREIGN KEY ("alertEventId") REFERENCES "alert_events" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "users" ADD CONSTRAINT "users_check_1" CHECK ("email" = lower(btrim("email")) AND length("email") > 3);

ALTER TABLE "assets" ADD CONSTRAINT "assets_check_1" CHECK ("quoteCurrency" = 'USD');

ALTER TABLE "assets" ADD CONSTRAINT "assets_check_2" CHECK ("type" <> 'STOCK' OR "isDemoOnly");

ALTER TABLE "latest_quotes" ADD CONSTRAINT "latest_quotes_check_1" CHECK ("price" > 0);

ALTER TABLE "latest_quotes" ADD CONSTRAINT "latest_quotes_check_2" CHECK ("currency" = 'USD');

ALTER TABLE "latest_quotes" ADD CONSTRAINT "latest_quotes_check_3" CHECK (("provider" = 'DEMO') = ("mode" = 'DEMO'));

ALTER TABLE "historical_bars" ADD CONSTRAINT "historical_bars_check_1" CHECK ("close" > 0);

ALTER TABLE "historical_bars" ADD CONSTRAINT "historical_bars_check_2" CHECK ("volume" IS NULL OR "volume" >= 0);

ALTER TABLE "historical_bars" ADD CONSTRAINT "historical_bars_check_3" CHECK ("currency" = 'USD');

ALTER TABLE "historical_bars" ADD CONSTRAINT "historical_bars_check_4" CHECK (("provider" = 'DEMO') = ("mode" = 'DEMO'));

ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_check_1" CHECK ("baseCurrency" = 'USD');

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_check_1" CHECK ("quantity" > 0);

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_check_2" CHECK ("unitPrice" > 0);

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_check_3" CHECK ("fee" >= 0);

ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_check_1" CHECK ("threshold" > 0);

ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_check_2" CHECK ("activation" > 0);

ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_check_3" CHECK ("currency" = 'USD');

ALTER TABLE "price_alerts" ADD CONSTRAINT "price_alerts_check_4" CHECK (("provider" = 'DEMO') = ("mode" = 'DEMO'));

ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_check_1" CHECK ("activation" > 0);

ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_check_2" CHECK ("observedPrice" > 0);

ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_check_1" CHECK ("attempts" >= 0);

ALTER TABLE "provider_usage" ADD CONSTRAINT "provider_usage_check_1" CHECK ("reserved" >= 0 AND "consumed" >= 0);

ALTER TABLE "provider_usage" ADD CONSTRAINT "provider_usage_check_2" CHECK ("windowEnd" > "windowStart");

CREATE FUNCTION enforce_demo_asset_mode() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."mode" = 'REAL' AND EXISTS (SELECT 1 FROM assets WHERE id = NEW."assetId" AND "isDemoOnly") THEN
    RAISE EXCEPTION 'Demo-only asset cannot use REAL mode' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "latest_quotes_demo_mode" BEFORE INSERT OR UPDATE ON "latest_quotes" FOR EACH ROW EXECUTE FUNCTION enforce_demo_asset_mode();

CREATE TRIGGER "historical_bars_demo_mode" BEFORE INSERT OR UPDATE ON "historical_bars" FOR EACH ROW EXECUTE FUNCTION enforce_demo_asset_mode();

CREATE TRIGGER "transactions_demo_mode" BEFORE INSERT OR UPDATE ON "transactions" FOR EACH ROW EXECUTE FUNCTION enforce_demo_asset_mode();

CREATE TRIGGER "price_alerts_demo_mode" BEFORE INSERT OR UPDATE ON "price_alerts" FOR EACH ROW EXECUTE FUNCTION enforce_demo_asset_mode();
