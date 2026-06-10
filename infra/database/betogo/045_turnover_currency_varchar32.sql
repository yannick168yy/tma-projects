-- 045: 将 bg_turnover_requirements / bg_turnover_logs 的 currency 列扩至 VARCHAR(32)
-- 修复 TRX_TESTNET（11 字符）等长币种代码导致 INSERT 失败、流水进度永远 0% 的 bug
-- 幂等：已是 >= 16 则 MODIFY 成本极低（MySQL 不重建行），可安全重复执行

SET @db = DATABASE();

-- bg_turnover_requirements.currency
SET @len = (
  SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bg_turnover_requirements' AND COLUMN_NAME = 'currency'
);
SET @sql = IF(@len IS NOT NULL AND @len < 32,
  'ALTER TABLE bg_turnover_requirements MODIFY COLUMN currency VARCHAR(32) NOT NULL DEFAULT ''PHP''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- bg_turnover_logs.currency
SET @len = (
  SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bg_turnover_logs' AND COLUMN_NAME = 'currency'
);
SET @sql = IF(@len IS NOT NULL AND @len < 32,
  'ALTER TABLE bg_turnover_logs MODIFY COLUMN currency VARCHAR(32) NOT NULL DEFAULT ''PHP''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
