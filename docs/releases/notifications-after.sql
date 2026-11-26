-- Read-only post-migration checks. Every "problem" result must be empty.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT 'missing column: ' || name AS problem
FROM (VALUES ('kind'), ('eventKey'), ('subjectType'), ('subjectId')) AS expected(name)
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = current_schema() AND table_name = 'notifications' AND column_name = expected.name
);
SELECT 'missing index: ' || name AS problem
FROM (VALUES
  ('notifications_userId_alertEventId_key'),
  ('notifications_userId_createdAt_idx'),
  ('notifications_userId_eventKey_key'),
  ('notifications_userId_createdAt_id_idx'),
  ('notifications_userId_readAt_createdAt_id_idx')
) AS expected(name)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'notifications' AND indexname = expected.name
);
SELECT 'missing or unvalidated constraint: ' || name AS problem
FROM (VALUES
  ('notifications', 'notifications_event_key_check'),
  ('notifications', 'notifications_subject_check'),
  ('notifications', 'notifications_activity_only_check'),
  ('notifications', 'notifications_message_check'),
  ('notification_preferences', 'notification_preferences_userId_fkey')
) AS expected(relation, name)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = current_schema() AND t.relname = expected.relation AND c.conname = expected.name AND c.convalidated
);
SELECT 'failed migration: ' || migration_name AS problem
FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL;
SELECT kind, count(*) AS rows FROM notifications GROUP BY kind ORDER BY kind;
SELECT count(*) AS preference_rows FROM notification_preferences;
SELECT 'users' AS relation, count(*) AS rows FROM users
UNION ALL SELECT 'sessions', count(*) FROM sessions
UNION ALL SELECT 'assets', count(*) FROM assets
UNION ALL SELECT 'watchlists', count(*) FROM watchlists
UNION ALL SELECT 'watchlist_items', count(*) FROM watchlist_items
UNION ALL SELECT 'notifications', count(*) FROM notifications
UNION ALL SELECT 'price_alerts', count(*) FROM price_alerts
UNION ALL SELECT 'alert_events', count(*) FROM alert_events;
COMMIT;
