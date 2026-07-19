-- 将 cs_conversation.user_id 从 BIGINT 改为 VARCHAR(20)，与 bg_user.id 格式一致（BG-XXXXX）
SET @col_type = (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cs_conversation' AND COLUMN_NAME = 'user_id'
);

SET @sql = IF(
  @col_type = 'varchar(20)',
  'SELECT 1',
  'ALTER TABLE cs_conversation MODIFY COLUMN user_id VARCHAR(20) NOT NULL'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
