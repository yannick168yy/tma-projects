-- 为 sg_games 添加权重分项字段
-- weight_breakdown 存 JSON：{ provider_base, ph_bonus, feature_score, featured_bonus }
-- 幂等：列不存在才添加

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'sg_games'
    AND COLUMN_NAME  = 'weight_breakdown'
);

SET @sql = IF(
  @col_exists = 0,
  'ALTER TABLE sg_games ADD COLUMN weight_breakdown JSON NULL AFTER weight_updated_at',
  'SELECT ''weight_breakdown already exists, skipping'''
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
