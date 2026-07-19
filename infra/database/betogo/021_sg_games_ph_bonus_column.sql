-- 1. 新增 ph_bonus 独立字段，放在 weight 后面
-- 2. 将 weight_breakdown 移到 ph_bonus 后面
-- 3. 从已有 weight_breakdown JSON 回填 ph_bonus

SET @ph_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sg_games' AND COLUMN_NAME = 'ph_bonus'
);

SET @add_sql = IF(
  @ph_exists = 0,
  'ALTER TABLE sg_games ADD COLUMN ph_bonus TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER weight',
  'SELECT ''ph_bonus already exists, skipping'''
);
PREPARE stmt FROM @add_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 调整 weight_breakdown 顺序（MODIFY 不删数据）
ALTER TABLE sg_games MODIFY COLUMN weight_breakdown JSON NULL AFTER ph_bonus;

-- 从 weight_breakdown 回填 ph_bonus（只处理有 JSON 数据且 ph_bonus=0 的行）
UPDATE sg_games
SET ph_bonus = CAST(JSON_UNQUOTE(JSON_EXTRACT(weight_breakdown, '$.ph_bonus')) AS UNSIGNED)
WHERE weight_breakdown IS NOT NULL
  AND JSON_EXTRACT(weight_breakdown, '$.ph_bonus') IS NOT NULL
  AND ph_bonus = 0;
