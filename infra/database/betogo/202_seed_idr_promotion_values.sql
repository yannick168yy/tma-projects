-- 印尼活动初始化：按 1 PHP = 287 IDR 换算，金额四舍五入到百位。
-- 仅补充尚未配置的 IDR 数据，不覆盖运营之后的人工调整。

INSERT INTO bg_firstdep_tiers (currency, deposit_amount, bonus_amount)
SELECT 'IDR',
       GREATEST(100, ROUND(deposit_amount * 287 / 100) * 100),
       GREATEST(100, ROUND(bonus_amount * 287 / 100) * 100)
FROM bg_firstdep_tiers php
WHERE php.currency = 'PHP'
  AND NOT EXISTS (SELECT 1 FROM bg_firstdep_tiers idr WHERE idr.currency = 'IDR');

INSERT INTO bg_promo_config (promo_id, config_key, config_value)
SELECT 'redep', 'min_deposit_idr', CAST(GREATEST(100, ROUND(CAST(config_value AS DECIMAL(18,6)) * 287 / 100) * 100) AS CHAR)
FROM bg_promo_config
WHERE promo_id = 'redep' AND config_key = 'min_deposit'
  AND NOT EXISTS (SELECT 1 FROM bg_promo_config x WHERE x.promo_id = 'redep' AND x.config_key = 'min_deposit_idr');

UPDATE bg_promo_config idr
JOIN bg_promo_config php ON php.promo_id = 'redep' AND php.config_key = 'min_deposit'
SET idr.config_value = CAST(GREATEST(100, ROUND(CAST(php.config_value AS DECIMAL(18,6)) * 287 / 100) * 100) AS CHAR)
WHERE idr.promo_id = 'redep' AND idr.config_key = 'min_deposit_idr' AND CAST(idr.config_value AS DECIMAL(18,6)) = 0;

INSERT INTO bg_promo_config (promo_id, config_key, config_value)
SELECT 'redep', 'bonus_amount_idr', CAST(GREATEST(100, ROUND(CAST(config_value AS DECIMAL(18,6)) * 287 / 100) * 100) AS CHAR)
FROM bg_promo_config
WHERE promo_id = 'redep' AND config_key = 'bonus_amount'
  AND NOT EXISTS (SELECT 1 FROM bg_promo_config x WHERE x.promo_id = 'redep' AND x.config_key = 'bonus_amount_idr');

UPDATE bg_promo_config idr
JOIN bg_promo_config php ON php.promo_id = 'redep' AND php.config_key = 'bonus_amount'
SET idr.config_value = CAST(GREATEST(100, ROUND(CAST(php.config_value AS DECIMAL(18,6)) * 287 / 100) * 100) AS CHAR)
WHERE idr.promo_id = 'redep' AND idr.config_key = 'bonus_amount_idr' AND CAST(idr.config_value AS DECIMAL(18,6)) = 0;

INSERT INTO bg_promo_config (promo_id, config_key, config_value)
SELECT 'loss_rebate', 'min_deposit_idr', CAST(GREATEST(100, ROUND(CAST(config_value AS DECIMAL(18,6)) * 287 / 100) * 100) AS CHAR)
FROM bg_promo_config
WHERE promo_id = 'loss_rebate' AND config_key = 'min_deposit'
  AND NOT EXISTS (SELECT 1 FROM bg_promo_config x WHERE x.promo_id = 'loss_rebate' AND x.config_key = 'min_deposit_idr');

UPDATE bg_promo_config idr
JOIN bg_promo_config php ON php.promo_id = 'loss_rebate' AND php.config_key = 'min_deposit'
SET idr.config_value = CAST(GREATEST(100, ROUND(CAST(php.config_value AS DECIMAL(18,6)) * 287 / 100) * 100) AS CHAR)
WHERE idr.promo_id = 'loss_rebate' AND idr.config_key = 'min_deposit_idr' AND CAST(idr.config_value AS DECIMAL(18,6)) = 0;

INSERT INTO bg_spin_prize
  (rule_id, currency, name, image_key, amount_php, weight, turnover_x, enabled, sort_order)
SELECT p.rule_id,
       'IDR',
       CASE WHEN p.name LIKE '%₱%'
         THEN CONCAT('Rp', REPLACE(FORMAT(GREATEST(100, ROUND(p.amount_php * 287 / 100) * 100), 0), ',', '.'))
         ELSE p.name END,
       p.image_key,
       GREATEST(100, ROUND(p.amount_php * 287 / 100) * 100),
       p.weight,
       p.turnover_x,
       p.enabled,
       p.sort_order
FROM bg_spin_prize p
WHERE p.currency = 'PHP'
  AND NOT EXISTS (
    SELECT 1 FROM bg_spin_prize idr
    WHERE idr.currency = 'IDR' AND idr.rule_id = p.rule_id AND idr.sort_order = p.sort_order
  );
