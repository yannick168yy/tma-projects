-- 动图封面独立字段：image_override 恒为静态首帧(轻,首屏加载)，image_anim 存动图(懒加载增强)
-- 前端默认显示 image_override 静图，卡片进视口后再加载 image_anim 动图并切换播放，避免动图拖慢首屏
ALTER TABLE `bg_568win_game_override`
  ADD COLUMN `image_anim` VARCHAR(512) NULL COMMENT '动图封面URL(懒加载,静态首帧用image_override)' AFTER `image_override_source`;
