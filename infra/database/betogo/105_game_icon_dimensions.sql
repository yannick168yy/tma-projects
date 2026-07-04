-- 105: 游戏封面实际像素宽高（横竖版判定依据），由 core-node 同步后自动探测回填
ALTER TABLE `bg_568win_game`
  ADD COLUMN `icon_width`  SMALLINT UNSIGNED NULL COMMENT '封面实际像素宽' AFTER `icon_url`,
  ADD COLUMN `icon_height` SMALLINT UNSIGNED NULL COMMENT '封面实际像素高' AFTER `icon_width`,
  ADD COLUMN `icon_probed_at` DATETIME(3) NULL COMMENT '宽高探测时间，NULL=待探测' AFTER `icon_height`;
