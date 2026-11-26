-- E1 foundation only: no producers, notification backfill, or price-alert activation.
-- One transaction keeps an interrupted migration from leaving partial DDL.
BEGIN;

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('LEGACY', 'ACCOUNT_CREATED', 'SIGNED_IN', 'SESSION_REVOKED', 'PASSWORD_RESET', 'EMAIL_VERIFIED', 'WATCHLIST_CREATED', 'WATCHLIST_RENAMED', 'WATCHLIST_DELETED', 'WATCHLIST_ASSET_ADDED', 'WATCHLIST_ASSET_REMOVED');

-- CreateEnum
CREATE TYPE "NotificationSubjectType" AS ENUM ('ACCOUNT', 'WATCHLIST');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "eventKey" VARCHAR(160),
ADD COLUMN     "kind" "NotificationKind" NOT NULL DEFAULT 'LEGACY',
ADD COLUMN     "subjectId" UUID,
ADD COLUMN     "subjectType" "NotificationSubjectType";

-- CreateTable
CREATE TABLE "notification_preferences" (
    "userId" UUID NOT NULL,
    "accountActivityEnabled" BOOLEAN NOT NULL DEFAULT true,
    "watchlistActivityEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_id_idx" ON "notifications"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_id_idx" ON "notifications"("userId", "readAt", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_userId_eventKey_key" ON "notifications"("userId", "eventKey");

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Old rows have LEGACY + NULL metadata; their existing content is not rewritten.
-- New keys identify one kind/operation UUID and are unique per recipient.
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_event_key_check" CHECK (
  ("kind" = 'LEGACY' AND "eventKey" IS NULL)
  OR
  ("kind" <> 'LEGACY' AND "eventKey" IS NOT NULL AND
    "eventKey" ~ ('^' || "kind"::text || ':[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'))
);

-- Subject IDs are snapshots: deleting a watchlist must not erase its activity history.
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subject_check" CHECK (
  ("kind" = 'LEGACY' AND "subjectType" IS NULL AND "subjectId" IS NULL)
  OR
  ("kind" <> 'LEGACY' AND "subjectType" IS NOT NULL AND "subjectId" IS NOT NULL AND (
    ("kind" IN ('ACCOUNT_CREATED', 'SIGNED_IN', 'SESSION_REVOKED', 'PASSWORD_RESET', 'EMAIL_VERIFIED')
      AND "subjectType" = 'ACCOUNT' AND "subjectId" = "userId")
    OR
    ("kind" IN ('WATCHLIST_CREATED', 'WATCHLIST_RENAMED', 'WATCHLIST_DELETED', 'WATCHLIST_ASSET_ADDED', 'WATCHLIST_ASSET_REMOVED')
      AND "subjectType" = 'WATCHLIST')
  ))
);

-- Existing alert references remain valid only as legacy history, not new price events.
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_activity_only_check" CHECK (
  "kind" = 'LEGACY' OR "alertEventId" IS NULL
);
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_message_check" CHECK (
  "kind" = 'LEGACY' OR "message" ~ '[^[:space:]]'
);

COMMIT;
