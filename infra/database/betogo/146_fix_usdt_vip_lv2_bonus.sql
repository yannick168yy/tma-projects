-- 修正多币种 VIP 初始换算：LV2 晋级礼金 PHP 5 / 58 曾四舍五入为 0.09。
-- 产品口径为稳定币 LV2 晋级礼金 0.10；仅修正仍保持旧默认值的配置，避免覆盖后台后续手动调整。
UPDATE `bg_vip_level_benefit`
SET `promotion_bonus` = 0.10
WHERE `level` = 2
  AND `currency` IN ('USDT', 'USDC')
  AND `promotion_bonus` = 0.09;
