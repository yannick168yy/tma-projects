-- 记录 image_override 封面来源（playtime/gzone/manual 等），便于溯源与批量管理
ALTER TABLE `bg_568win_game_override`
  ADD COLUMN `image_override_source` VARCHAR(32) NULL COMMENT '封面覆盖来源: playtime/gzone/casinoplus/manual' AFTER `image_override`;
