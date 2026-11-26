-- Read-only inventory. Run on production ONLY after release approval.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT current_database() AS database, current_schema() AS schema,
       current_setting('server_version') AS postgres_version;
SELECT migration_name, finished_at IS NOT NULL AS applied,
       rolled_back_at IS NOT NULL AS rolled_back
FROM _prisma_migrations ORDER BY started_at;
SELECT 'users' AS relation, count(*) AS rows FROM users
UNION ALL SELECT 'sessions', count(*) FROM sessions
UNION ALL SELECT 'assets', count(*) FROM assets
UNION ALL SELECT 'watchlists', count(*) FROM watchlists
UNION ALL SELECT 'watchlist_items', count(*) FROM watchlist_items
UNION ALL SELECT 'notifications', count(*) FROM notifications
UNION ALL SELECT 'price_alerts', count(*) FROM price_alerts
UNION ALL SELECT 'alert_events', count(*) FROM alert_events;
SELECT to_regclass(format('%I.notification_preferences', current_schema())) IS NOT NULL
       AS preferences_table_already_exists;
COMMIT;
