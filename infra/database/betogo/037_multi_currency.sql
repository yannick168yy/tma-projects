-- 037_multi_currency.sql
-- 多货币架构改造：加 currency 字段
-- 全部操作幂等，可安全重复执行

-- ── bg_turnover_requirements：加 currency ────────────────────────────────────
SET @s = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_turnover_requirements' AND COLUMN_NAME='currency') = 0,
  'ALTER TABLE bg_turnover_requirements ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT ''PHP'' AFTER user_id',
  'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @s = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_turnover_requirements' AND INDEX_NAME='idx_turnover_req_user_currency_status') = 0,
  'CREATE INDEX idx_turnover_req_user_currency_status ON bg_turnover_requirements (user_id, currency, status)',
  'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ── bg_turnover_logs：加 currency ────────────────────────────────────────────
SET @s = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_turnover_logs' AND COLUMN_NAME='currency') = 0,
  'ALTER TABLE bg_turnover_logs ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT ''PHP'' AFTER user_id',
  'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ── bg_team_ggr_monthly：加 currency，删旧唯一键，建新唯一键 ─────────────────
SET @s = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_team_ggr_monthly' AND COLUMN_NAME='currency') = 0,
  'ALTER TABLE bg_team_ggr_monthly ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT ''PHP'' AFTER period',
  'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @s = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_team_ggr_monthly' AND INDEX_NAME='uk_user_period') > 0,
  'ALTER TABLE bg_team_ggr_monthly DROP INDEX uk_user_period',
  'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @s = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_team_ggr_monthly' AND INDEX_NAME='uniq_ggr_user_period_currency') = 0,
  'CREATE UNIQUE INDEX uniq_ggr_user_period_currency ON bg_team_ggr_monthly (user_id, period, currency)',
  'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ── bg_team_commission：加 currency ──────────────────────────────────────────
SET @s = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_team_commission' AND COLUMN_NAME='currency') = 0,
  'ALTER TABLE bg_team_commission ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT ''PHP'' AFTER period',
  'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- ── bg_team_wallet：支持多币种，改 PK 为 (user_id, currency) ─────────────────
SET @s = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_team_wallet' AND COLUMN_NAME='currency') = 0,
  'ALTER TABLE bg_team_wallet ADD COLUMN currency VARCHAR(10) NOT NULL DEFAULT ''PHP''',
  'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @s = IF(
  (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_team_wallet' AND CONSTRAINT_NAME='fk_tw_user') > 0,
  'ALTER TABLE bg_team_wallet DROP FOREIGN KEY fk_tw_user',
  'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 仅当 PK 只有 user_id 一列时才重建
SET @s = IF(
  (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_team_wallet' AND CONSTRAINT_NAME='PRIMARY') = 1,
  'ALTER TABLE bg_team_wallet DROP PRIMARY KEY, ADD PRIMARY KEY (user_id, currency)',
  'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @s = IF(
  (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_team_wallet' AND CONSTRAINT_NAME='fk_tw_user') = 0,
  'ALTER TABLE bg_team_wallet ADD CONSTRAINT fk_tw_user FOREIGN KEY (user_id) REFERENCES bg_user (id)',
  'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
