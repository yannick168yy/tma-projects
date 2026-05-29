-- 018: sg_games 增加 AI 富化字段（权重/描述/分类/关键词等）
SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS `__migrate_018`;
DELIMITER $$
CREATE PROCEDURE `__migrate_018`()
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sg_games' AND COLUMN_NAME='weight') = 0 THEN
    ALTER TABLE `sg_games`
      ADD COLUMN `weight`            SMALLINT     NOT NULL DEFAULT 0   COMMENT '菲律宾市场受欢迎度 0-100'          AFTER `is_active`,
      ADD COLUMN `is_featured`       TINYINT(1)   NOT NULL DEFAULT 0   COMMENT '是否推荐到首页'                     AFTER `weight`,
      ADD COLUMN `sort_category`     VARCHAR(64)  NULL                 COMMENT '前端分类: slots/fishing/live/bingo/crash/table' AFTER `is_featured`,
      ADD COLUMN `theme`             VARCHAR(128) NULL                 COMMENT '游戏主题: fishing/asian/mythology/...' AFTER `sort_category`,
      ADD COLUMN `game_style`        VARCHAR(64)  NULL                 COMMENT '风格: asian/western/classic/modern'  AFTER `theme`,
      ADD COLUMN `player_type`       VARCHAR(64)  NULL                 COMMENT '适合玩家: casual/regular/high-roller' AFTER `game_style`,
      ADD COLUMN `description_en`    TEXT         NULL                 COMMENT '游戏英文简介'                        AFTER `player_type`,
      ADD COLUMN `description_zh`    TEXT         NULL                 COMMENT '游戏中文简介'                        AFTER `description_en`,
      ADD COLUMN `search_keywords`   TEXT         NULL                 COMMENT '站内搜索关键词（空格分隔）'            AFTER `description_zh`,
      ADD COLUMN `weight_updated_at` DATETIME(3)  NULL                 COMMENT '权重最后更新时间'                    AFTER `search_keywords`;
  END IF;
END $$
DELIMITER ;
CALL `__migrate_018`();
DROP PROCEDURE IF EXISTS `__migrate_018`;
