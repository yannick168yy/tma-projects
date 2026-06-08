-- 042: 币种代码扩至 VARCHAR(32)，防止用户传入超长 currency 字符串导致 SG 回调 INSERT 失败

SET @db = DATABASE();

SET @len = (SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'bg_bet_order' AND COLUMN_NAME = 'currency_code');
SET @sql = IF(@len IS NOT NULL AND @len < 32,
  'ALTER TABLE bg_bet_order MODIFY COLUMN currency_code VARCHAR(32) NOT NULL DEFAULT ''PHP''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
