-- 103: 568Win 网站分类
-- slot/casino/perya/poker/fishing/sports/lottery/lobby/other
-- 自动值由游戏同步按 new_game_type + 名称关键词计算，override 为人工覆盖
SET NAMES utf8mb4;

ALTER TABLE bg_568win_game
  ADD COLUMN site_category_auto VARCHAR(16) NULL COMMENT '网站分类（自动推导）' AFTER game_type,
  ADD KEY idx_site_category_auto (site_category_auto);

ALTER TABLE bg_568win_game_override
  ADD COLUMN site_category VARCHAR(16) NULL COMMENT '网站分类人工覆盖，NULL 跟随自动分类' AFTER sort_category,
  ADD KEY idx_site_category (site_category);
