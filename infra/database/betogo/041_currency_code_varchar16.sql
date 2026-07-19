-- 041: 币种代码扩至 VARCHAR(16)，与 bg_wallet.currency 对齐（支持 TRX_TESTNET 等）
-- 幂等：仅当当前长度 < 16 时执行

SET @db = DATABASE();

-- bg_bet_order.currency_code
SET @len = (SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bg_bet_order' AND COLUMN_NAME = 'currency_code');
SET @sql = IF(@len IS NOT NULL AND @len < 16,
  'ALTER TABLE bg_bet_order MODIFY COLUMN currency_code VARCHAR(16) NOT NULL DEFAULT ''PHP''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- bg_turnover_requirements.currency
SET @len = (SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bg_turnover_requirements' AND COLUMN_NAME = 'currency');
SET @sql = IF(@len IS NOT NULL AND @len < 16,
  'ALTER TABLE bg_turnover_requirements MODIFY COLUMN currency VARCHAR(16) NOT NULL DEFAULT ''PHP''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- bg_turnover_logs.currency
SET @len = (SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bg_turnover_logs' AND COLUMN_NAME = 'currency');
SET @sql = IF(@len IS NOT NULL AND @len < 16,
  'ALTER TABLE bg_turnover_logs MODIFY COLUMN currency VARCHAR(16) NOT NULL DEFAULT ''PHP''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- bg_team_ggr_monthly.currency
SET @len = (SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bg_team_ggr_monthly' AND COLUMN_NAME = 'currency');
SET @sql = IF(@len IS NOT NULL AND @len < 16,
  'ALTER TABLE bg_team_ggr_monthly MODIFY COLUMN currency VARCHAR(16) NOT NULL DEFAULT ''PHP''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- bg_team_commission.currency
SET @len = (SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bg_team_commission' AND COLUMN_NAME = 'currency');
SET @sql = IF(@len IS NOT NULL AND @len < 16,
  'ALTER TABLE bg_team_commission MODIFY COLUMN currency VARCHAR(16) NOT NULL DEFAULT ''PHP''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- bg_team_wallet.currency
SET @len = (SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bg_team_wallet' AND COLUMN_NAME = 'currency');
SET @sql = IF(@len IS NOT NULL AND @len < 16,
  'ALTER TABLE bg_team_wallet MODIFY COLUMN currency VARCHAR(16) NOT NULL DEFAULT ''PHP''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
