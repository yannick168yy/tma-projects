-- 029: 三级分销性能优化索引
--
-- status 接口对全表 SUM(l1_referrer_id = ?) 三次，
-- 加复合索引后走 index range scan，量大时从全表扫降为精准扫。
-- 幂等写法：先检查 information_schema 再 ALTER。

SET NAMES utf8mb4;

-- (l1_referrer_id, activated)：status 统计 + 结算 activated=1 过滤
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'bg_team_node'
    AND INDEX_NAME   = 'idx_l1_activated'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE bg_team_node ADD INDEX idx_l1_activated (l1_referrer_id, activated)',
  'SELECT ''idx_l1_activated already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- (l2_referrer_id, activated)
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'bg_team_node'
    AND INDEX_NAME   = 'idx_l2_activated'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE bg_team_node ADD INDEX idx_l2_activated (l2_referrer_id, activated)',
  'SELECT ''idx_l2_activated already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- (l3_referrer_id, activated)
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'bg_team_node'
    AND INDEX_NAME   = 'idx_l3_activated'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE bg_team_node ADD INDEX idx_l3_activated (l3_referrer_id, activated)',
  'SELECT ''idx_l3_activated already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- bg_team_commission (beneficiary_id, period, status)：结算汇总 + 提现记录查询
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'bg_team_commission'
    AND INDEX_NAME   = 'idx_beneficiary_period_status'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE bg_team_commission ADD INDEX idx_beneficiary_period_status (beneficiary_id, period, status)',
  'SELECT ''idx_beneficiary_period_status already exists'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
