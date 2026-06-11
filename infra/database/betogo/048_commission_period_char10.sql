-- 修复 bg_team_commission.period 字段：CHAR(7) → CHAR(10)
-- 原设计存 YYYY-MM，但结算代码写入的是 YYYY-MM-DD（10字符）
-- MySQL 非严格模式下会截断为 YYYY-MM，导致后续 WHERE period = 'YYYY-MM-DD' 无法匹配
-- → wallet 不更新、佣金永远是 pending 状态、无法提现
-- 改为 CHAR(10) 存完整日期，前端 LIKE 'YYYY-MM%' 查询不受影响

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'bg_team_commission'
    AND COLUMN_NAME = 'period'
    AND CHARACTER_MAXIMUM_LENGTH = 7
);

SET @sql = IF(@col_exists > 0,
  'ALTER TABLE bg_team_commission MODIFY COLUMN period CHAR(10) NOT NULL COMMENT ''佣金所属日期，如 2026-06-10''',
  'SELECT ''bg_team_commission.period already CHAR(10) or longer, skip'' AS msg'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
