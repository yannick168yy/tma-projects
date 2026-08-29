-- 203: 印尼市场活动、VIP、洗码与审核策略初始值
-- 金额按 1 PHP = 287 IDR 换算并取整到百位；百分比/次数保持不变。
SET NAMES utf8mb4;

ALTER TABLE bg_task_social
  ADD COLUMN reward_by_currency JSON NULL AFTER currency;

ALTER TABLE bg_task_manual_review
  ADD COLUMN currency VARCHAR(8) NOT NULL DEFAULT 'PHP' AFTER task_key;

UPDATE bg_task_social
SET reward_by_currency = JSON_OBJECT(
  'PHP', reward_amount,
  'IDR', ROUND(reward_amount * 287 / 100) * 100,
  'USDT', ROUND(reward_amount / 58, 2),
  'USDC', ROUND(reward_amount / 58, 2)
)
WHERE reward_by_currency IS NULL;

INSERT IGNORE INTO bg_vip_level_benefit
  (level, currency, promotion_bonus, weekly_salary, monthly_salary, birthday_bonus,
   negative_rebate_pct, retention_line, withdraw_daily_limit, withdraw_daily_count)
SELECT level, 'IDR',
  ROUND(promotion_bonus * 287 / 100) * 100,
  ROUND(weekly_salary * 287 / 100) * 100,
  ROUND(monthly_salary * 287 / 100) * 100,
  ROUND(birthday_bonus * 287 / 100) * 100,
  negative_rebate_pct,
  ROUND(retention_line * 287 / 100) * 100,
  ROUND(withdraw_daily_limit * 287 / 100) * 100,
  withdraw_daily_count
FROM bg_vip_level_benefit WHERE currency = 'PHP';

INSERT IGNORE INTO bg_rebate_level_threshold (level, currency, min_turnover)
SELECT level, 'IDR', ROUND(min_turnover * 287 / 100) * 100
FROM bg_rebate_level_threshold WHERE currency = 'PHP';

INSERT IGNORE INTO bg_rebate_level_config
  (level, game_category, currency, rate_pct, max_bonus, enabled)
SELECT level, game_category, 'IDR', rate_pct,
  ROUND(max_bonus * 287 / 100) * 100, enabled
FROM bg_rebate_level_config WHERE currency = 'PHP';

UPDATE bg_withdraw_review_config
SET params = JSON_SET(COALESCE(params, JSON_OBJECT()), '$.idr', 14350000)
WHERE rule_code = 'large_amount' AND JSON_EXTRACT(COALESCE(params, JSON_OBJECT()), '$.idr') IS NULL;

INSERT INTO bg_promo_config (promo_id, config_key, config_value) VALUES
  ('trial', 'amount_idr', '25300'),
  ('appdl', 'amount_idr', '18900'),
  ('loss_rebate', 'enabled_currencies', 'PHP,IDR,USDT,USDC'),
  ('firstdep', 'enabled', '1'),
  ('redep', 'enabled', '1'),
  ('loss_rebate', 'enabled', '1')
ON DUPLICATE KEY UPDATE config_value = VALUES(config_value);
