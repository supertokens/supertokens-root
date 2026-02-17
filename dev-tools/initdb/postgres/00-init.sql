-- ═══════════════════════════════════════════════════════════════════════
-- Runs automatically on first PostgreSQL container start.
-- Add any schemas, extensions, or seed data your tests need here.
-- ═══════════════════════════════════════════════════════════════════════

-- Enable pg_stat_monitor with 10-second buckets
CREATE EXTENSION IF NOT EXISTS pg_stat_monitor;
-- ALTER SYSTEM SET pg_stat_monitor.pgsm_bucket_time = 10;
-- SELECT pg_reload_conf();

CREATE DATABASE supertokens;
CREATE DATABASE st0;
CREATE DATABASE st1;
CREATE DATABASE st2;
CREATE DATABASE st3;
CREATE DATABASE st4;
CREATE DATABASE st5;
CREATE DATABASE st6;
CREATE DATABASE st7;
CREATE DATABASE st8;
CREATE DATABASE st9;
CREATE DATABASE st10;

CREATE DATABASE hydra;

