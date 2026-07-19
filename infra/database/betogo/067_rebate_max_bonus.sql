-- 067: 洗码分级新增「每日每大类封顶额」
--
-- bg_rebate_level_config 增加 max_bonus 列：每个等级·每个大类每日洗码金额上限。
-- 0 = 不封顶。结算/估算时若 max_bonus>0，则该大类当日洗码按上限封顶。后台可配置。

SET NAMES utf8mb4;

ALTER TABLE `bg_rebate_level_config`
  ADD COLUMN `max_bonus` DECIMAL(18,2) NOT NULL DEFAULT 0
    COMMENT '每日每大类洗码封顶额（0=不封顶）' AFTER `rate_pct`;
