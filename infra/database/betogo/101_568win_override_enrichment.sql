ALTER TABLE `bg_568win_game_override`
  ADD COLUMN `ph_bonus` TINYINT UNSIGNED NULL COMMENT '菲律宾市场热度加分 0-30' AFTER `weight`,
  ADD COLUMN `weight_breakdown` JSON NULL COMMENT '权重评分明细 JSON' AFTER `ph_bonus`,
  ADD COLUMN `theme` VARCHAR(128) NULL COMMENT '游戏主题: fishing/asian/mythology/...' AFTER `sort_category`,
  ADD COLUMN `game_style` VARCHAR(64) NULL COMMENT '风格: asian/western/classic/modern' AFTER `theme`,
  ADD COLUMN `player_type` VARCHAR(64) NULL COMMENT '适合玩家: casual/regular/high-roller' AFTER `game_style`,
  ADD COLUMN `description_en` TEXT NULL COMMENT '游戏英文简介' AFTER `player_type`,
  ADD COLUMN `description_zh` TEXT NULL COMMENT '游戏中文简介' AFTER `description_en`,
  ADD COLUMN `search_keywords` TEXT NULL COMMENT '站内搜索关键词（空格分隔）' AFTER `description_zh`,
  ADD COLUMN `weight_updated_at` DATETIME(3) NULL COMMENT '权重最后更新时间' AFTER `search_keywords`;
