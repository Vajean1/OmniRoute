-- 028_quota_snapshots_usage_columns.sql
-- Adds normalized usage fields for quota snapshot analytics.

ALTER TABLE quota_snapshots ADD COLUMN used_percentage REAL;
ALTER TABLE quota_snapshots ADD COLUMN used_amount REAL;
ALTER TABLE quota_snapshots ADD COLUMN total_amount REAL;
