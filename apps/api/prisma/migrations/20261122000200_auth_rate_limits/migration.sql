CREATE TABLE "auth_rate_limits" (
  "key" VARCHAR(64) NOT NULL,
  "windowStart" TIMESTAMPTZ(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("key", "windowStart"),
  CONSTRAINT "auth_rate_limits_positive" CHECK ("count" > 0),
  CONSTRAINT "auth_rate_limits_window" CHECK ("expiresAt" > "windowStart")
);
CREATE INDEX "auth_rate_limits_expiresAt_idx" ON "auth_rate_limits" ("expiresAt");
