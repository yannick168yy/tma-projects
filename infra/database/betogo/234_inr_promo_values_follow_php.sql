-- 234: 按运营要求调整印度站活动数值。
-- 首充嘉年华 / 常规复充 / 负盈利返水：INR 直接取与 PHP 相同的数值（不再按汇率换算）；
-- App 下载礼金固定 ₹30；复充限时固定「充 ₹700 送 ₹100」。
-- 230 当初按 1 PHP = 1.53 INR 换算，这里整体覆盖为运营定的值。
SET NAMES utf8mb4;

-- ── 首充嘉年华：INR 档位整套对齐 PHP ──────────────────────────────────────
-- 档位数量可能与 PHP 不同，先清掉本币种旧档再按 PHP 重建（WHERE 精确限定 INR）。
DELETE FROM bg_firstdep_tiers WHERE currency = 'INR';
INSERT INTO bg_firstdep_tiers (currency, deposit_amount, bonus_amount)
SELECT 'INR', deposit_amount, bonus_amount FROM bg_firstdep_tiers WHERE currency = 'PHP';

-- ── 常规复充：档位与每日赠金上限对齐 PHP ──────────────────────────────────
UPDATE bg_promo_config
SET config_value = JSON_SET(config_value, '$.INR', JSON_EXTRACT(config_value, '$.PHP'))
WHERE promo_id = 'redep_regular' AND config_key IN ('tiers', 'daily_bonus_caps')
  AND JSON_VALID(config_value)
  AND JSON_EXTRACT(config_value, '$.PHP') IS NOT NULL;

-- ── 负盈利返水：存款门槛对齐 PHP ──────────────────────────────────────────
UPDATE bg_promo_config inr
JOIN bg_promo_config php
  ON php.promo_id = 'loss_rebate' AND php.config_key = 'min_deposit'
SET inr.config_value = php.config_value
WHERE inr.promo_id = 'loss_rebate' AND inr.config_key = 'min_deposit_inr';

-- ── App 下载礼金 / 复充限时：运营指定的固定值 ─────────────────────────────
INSERT INTO bg_promo_config (promo_id, config_key, config_value) VALUES
  ('appdl', 'amount_inr',       '30'),
  ('redep', 'min_deposit_inr',  '700'),
  ('redep', 'bonus_amount_inr', '100')
ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);
