-- 027: bg_team_node 增加代理开启标记列
-- 用户主动点击"立即开启"后 opted_in=1，才能使用分销功能
-- 此前 026 已建 bg_team_node，本迁移仅追加两列 + sentinel 表

SET NAMES utf8mb4;

-- opted_in（幂等：检查 information_schema）
SET @has_optin = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'bg_team_node'
    AND COLUMN_NAME  = 'opted_in'
);
SET @sql = IF(
  @has_optin = 0,
  'ALTER TABLE `bg_team_node` ADD COLUMN `opted_in` TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''用户已主动开启代理'' AFTER `activated_at`',
  'SELECT 1 AS skipped'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- opted_in_at
SET @has_opted_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'bg_team_node'
    AND COLUMN_NAME  = 'opted_in_at'
);
SET @sql2 = IF(
  @has_opted_at = 0,
  'ALTER TABLE `bg_team_node` ADD COLUMN `opted_in_at` DATETIME(3) NULL COMMENT ''开启代理时间'' AFTER `opted_in`',
  'SELECT 1 AS skipped'
);
PREPARE stmt FROM @sql2; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 迁移脚本检测标记表（sentinel），deploy 脚本用文件名推断表名 bg_team_optin
CREATE TABLE IF NOT EXISTS `bg_team_optin` (
  `id` TINYINT NOT NULL DEFAULT 1,
  `applied_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='迁移哨兵表，无实际业务用途';

INSERT IGNORE INTO `bg_team_optin` (`id`) VALUES (1);
