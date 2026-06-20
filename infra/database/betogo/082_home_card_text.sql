-- 首页小卡片改为「固定背景皮肤 + 图标 + 文字」模板：
-- image_key 复用为图标小图，新增金色数值文案 value_text、浅色标签文案 label_text。
-- banner 不使用这两列。
ALTER TABLE `bg_home_content`
  ADD COLUMN `value_text` VARCHAR(32) NULL AFTER `action_value`,
  ADD COLUMN `label_text` VARCHAR(32) NULL AFTER `value_text`;
