-- 230: 印度市场（INR）激励配置初始值，数值全部参照当前 PHP 配置换算。
-- 汇率 1 PHP = 1.53 INR（由 USDT_TO_PHP_RATE 62.7 / USDT_TO_INR_RATE 95.9 推导）。
-- 取整阶梯与 utils/inr.ts 的 toInrRounded 保持一致：
--   ≤0 → 0；≥1000 取百位；100~999 取十位；<100 取个位（正数最低 1）。
--   1 PHP 只合 1.53 INR，若一律取整到百位，₱20 档会变成 ₹100（≈₱65），小额档位被放大数倍。
-- 只补尚未存在的 INR 行，不覆盖运营后续的人工调整。
SET NAMES utf8mb4;

-- ── VIP 权益 ──────────────────────────────────────────────────────────────
INSERT IGNORE INTO bg_vip_level_benefit
  (level, currency, promotion_bonus, weekly_salary, monthly_salary, birthday_bonus,
   negative_rebate_pct, retention_line, withdraw_daily_limit, withdraw_daily_count)
SELECT level, 'INR',
  CASE WHEN promo    <= 0 THEN 0 WHEN promo    >= 1000 THEN ROUND(promo/100)*100    WHEN promo    >= 100 THEN ROUND(promo/10)*10    ELSE GREATEST(1, ROUND(promo))    END,
  CASE WHEN weekly   <= 0 THEN 0 WHEN weekly   >= 1000 THEN ROUND(weekly/100)*100   WHEN weekly   >= 100 THEN ROUND(weekly/10)*10   ELSE GREATEST(1, ROUND(weekly))   END,
  CASE WHEN monthly  <= 0 THEN 0 WHEN monthly  >= 1000 THEN ROUND(monthly/100)*100  WHEN monthly  >= 100 THEN ROUND(monthly/10)*10  ELSE GREATEST(1, ROUND(monthly))  END,
  CASE WHEN birthday <= 0 THEN 0 WHEN birthday >= 1000 THEN ROUND(birthday/100)*100 WHEN birthday >= 100 THEN ROUND(birthday/10)*10 ELSE GREATEST(1, ROUND(birthday)) END,
  negative_rebate_pct,
  CASE WHEN retain   <= 0 THEN 0 WHEN retain   >= 1000 THEN ROUND(retain/100)*100   WHEN retain   >= 100 THEN ROUND(retain/10)*10   ELSE GREATEST(1, ROUND(retain))   END,
  CASE WHEN wd_limit <= 0 THEN 0 WHEN wd_limit >= 1000 THEN ROUND(wd_limit/100)*100 WHEN wd_limit >= 100 THEN ROUND(wd_limit/10)*10 ELSE GREATEST(1, ROUND(wd_limit)) END,
  withdraw_daily_count
FROM (
  SELECT level, negative_rebate_pct, withdraw_daily_count,
         promotion_bonus*1.53 AS promo, weekly_salary*1.53 AS weekly, monthly_salary*1.53 AS monthly,
         birthday_bonus*1.53 AS birthday, retention_line*1.53 AS retain, withdraw_daily_limit*1.53 AS wd_limit
  FROM bg_vip_level_benefit WHERE currency = 'PHP'
) t;

-- ── 洗码：等级流水阈值 + 分级费率封顶 ──────────────────────────────────────
INSERT IGNORE INTO bg_rebate_level_threshold (level, currency, min_turnover)
SELECT level, 'INR',
  CASE WHEN v <= 0 THEN 0 WHEN v >= 1000 THEN ROUND(v/100)*100 WHEN v >= 100 THEN ROUND(v/10)*10 ELSE GREATEST(1, ROUND(v)) END
FROM (SELECT level, min_turnover*1.53 AS v FROM bg_rebate_level_threshold WHERE currency = 'PHP') t;

INSERT IGNORE INTO bg_rebate_level_config (level, game_category, currency, rate_pct, max_bonus, enabled)
SELECT level, game_category, 'INR', rate_pct,
  CASE WHEN v <= 0 THEN 0 WHEN v >= 1000 THEN ROUND(v/100)*100 WHEN v >= 100 THEN ROUND(v/10)*10 ELSE GREATEST(1, ROUND(v)) END,
  enabled
FROM (SELECT level, game_category, rate_pct, enabled, max_bonus*1.53 AS v FROM bg_rebate_level_config WHERE currency = 'PHP') t;

-- ── 首充嘉年华档位 ────────────────────────────────────────────────────────
INSERT INTO bg_firstdep_tiers (currency, deposit_amount, bonus_amount)
SELECT 'INR',
  CASE WHEN d <= 0 THEN 0 WHEN d >= 1000 THEN ROUND(d/100)*100 WHEN d >= 100 THEN ROUND(d/10)*10 ELSE GREATEST(1, ROUND(d)) END,
  CASE WHEN b <= 0 THEN 0 WHEN b >= 1000 THEN ROUND(b/100)*100 WHEN b >= 100 THEN ROUND(b/10)*10 ELSE GREATEST(1, ROUND(b)) END
FROM (SELECT deposit_amount*1.53 AS d, bonus_amount*1.53 AS b FROM bg_firstdep_tiers WHERE currency = 'PHP') t
WHERE NOT EXISTS (SELECT 1 FROM bg_firstdep_tiers x WHERE x.currency = 'INR');

-- ── 转盘抽奖奖池 ──────────────────────────────────────────────────────────
-- rule_id 可为 NULL，去重必须用 NULL 安全等号 <=>，否则每次部署都会重复插一套奖池。
-- 名称按金额重建（现金奖品统一 ₹xxx），不靠匹配 ₱ 符号，避免字符集差异导致漏改。
INSERT INTO bg_spin_prize (rule_id, currency, name, image_key, amount_php, weight, turnover_x, enabled, sort_order)
SELECT rule_id, 'INR',
       CASE WHEN inr > 0 THEN CONCAT('₹', FORMAT(inr, 0)) ELSE name END,
       image_key, inr, weight, turnover_x, enabled, sort_order
FROM (
  SELECT p.rule_id, p.name, p.image_key, p.weight, p.turnover_x, p.enabled, p.sort_order,
         CASE WHEN p.amount_php*1.53 <= 0    THEN 0
              WHEN p.amount_php*1.53 >= 1000 THEN ROUND(p.amount_php*1.53/100)*100
              WHEN p.amount_php*1.53 >= 100  THEN ROUND(p.amount_php*1.53/10)*10
              ELSE GREATEST(1, ROUND(p.amount_php*1.53)) END AS inr
  FROM bg_spin_prize p
  WHERE p.currency = 'PHP'
    AND NOT EXISTS (
      SELECT 1 FROM bg_spin_prize x
      WHERE x.currency = 'INR' AND x.rule_id <=> p.rule_id AND x.sort_order = p.sort_order
    )
) t;

-- ── 任务中心：社交任务奖励补 INR ──────────────────────────────────────────
-- reward_type='spin'/'growth' 的任务 reward_amount=0，必须保持 0，不能抬成 ₹1。
UPDATE bg_task_social
SET reward_by_currency = JSON_SET(
  COALESCE(reward_by_currency, JSON_OBJECT()),
  '$.INR',
  CASE WHEN reward_amount*1.53 <= 0    THEN 0
       WHEN reward_amount*1.53 >= 1000 THEN ROUND(reward_amount*1.53/100)*100
       WHEN reward_amount*1.53 >= 100  THEN ROUND(reward_amount*1.53/10)*10
       ELSE GREATEST(1, ROUND(reward_amount*1.53)) END
)
WHERE JSON_EXTRACT(COALESCE(reward_by_currency, JSON_OBJECT()), '$.INR') IS NULL;

-- ── 活动配置：体验金 / 下载礼金 / 复充限时 / 负盈利返水 ────────────────────
-- 按 PHP 同名 key 换算写入 *_inr，已存在则不动。
INSERT INTO bg_promo_config (promo_id, config_key, config_value)
SELECT promo_id, CONCAT(config_key, '_inr'),
  CAST(CASE WHEN v <= 0 THEN 0 WHEN v >= 1000 THEN ROUND(v/100)*100 WHEN v >= 100 THEN ROUND(v/10)*10 ELSE GREATEST(1, ROUND(v)) END AS CHAR)
FROM (
  SELECT promo_id, config_key, CAST(config_value AS DECIMAL(18,6)) * 1.53 AS v
  FROM bg_promo_config
  WHERE (promo_id IN ('trial', 'appdl') AND config_key = 'amount')
     OR (promo_id = 'redep' AND config_key IN ('min_deposit', 'bonus_amount'))
     OR (promo_id = 'loss_rebate' AND config_key = 'min_deposit')
) t
WHERE NOT EXISTS (
  SELECT 1 FROM bg_promo_config x WHERE x.promo_id = t.promo_id AND x.config_key = CONCAT(t.config_key, '_inr')
);

-- 负盈利返水：印度站纳入可参与币种
UPDATE bg_promo_config
SET config_value = CONCAT(config_value, ',INR')
WHERE promo_id = 'loss_rebate' AND config_key = 'enabled_currencies'
  AND FIND_IN_SET('INR', config_value) = 0;

-- ── 常规复充档位 ──────────────────────────────────────────────────────────
-- JSON_TABLE 把 PHP 档位拆成行逐档换算再聚回数组；读取侧按 depositAmount 重排，聚合顺序无所谓。
UPDATE bg_promo_config c
JOIN (
  SELECT JSON_ARRAYAGG(JSON_OBJECT(
           'depositAmount', CASE WHEN d <= 0 THEN 0 WHEN d >= 1000 THEN ROUND(d/100)*100 WHEN d >= 100 THEN ROUND(d/10)*10 ELSE GREATEST(1, ROUND(d)) END,
           'bonusAmount',   CASE WHEN b <= 0 THEN 0 WHEN b >= 1000 THEN ROUND(b/100)*100 WHEN b >= 100 THEN ROUND(b/10)*10 ELSE GREATEST(1, ROUND(b)) END,
           'turnoverX',     turnover_x)) AS inr_tiers
  FROM (
    SELECT jt.deposit_amount * 1.53 AS d, jt.bonus_amount * 1.53 AS b, jt.turnover_x
    FROM bg_promo_config p
    JOIN JSON_TABLE(JSON_EXTRACT(p.config_value, '$.PHP'), '$[*]' COLUMNS (
      deposit_amount DECIMAL(18,6) PATH '$.depositAmount',
      bonus_amount   DECIMAL(18,6) PATH '$.bonusAmount',
      turnover_x     INT           PATH '$.turnoverX'
    )) jt
    WHERE p.promo_id = 'redep_regular' AND p.config_key = 'tiers' AND JSON_VALID(p.config_value)
  ) x
) agg
SET c.config_value = JSON_SET(c.config_value, '$.INR', agg.inr_tiers)
WHERE c.promo_id = 'redep_regular' AND c.config_key = 'tiers'
  AND JSON_VALID(c.config_value)
  AND JSON_EXTRACT(c.config_value, '$.PHP') IS NOT NULL
  AND JSON_EXTRACT(c.config_value, '$.INR') IS NULL
  AND agg.inr_tiers IS NOT NULL;

UPDATE bg_promo_config
SET config_value = JSON_SET(config_value, '$.INR',
  CASE WHEN CAST(JSON_UNQUOTE(JSON_EXTRACT(config_value, '$.PHP')) AS DECIMAL(18,6)) * 1.53 <= 0    THEN 0
       WHEN CAST(JSON_UNQUOTE(JSON_EXTRACT(config_value, '$.PHP')) AS DECIMAL(18,6)) * 1.53 >= 1000 THEN ROUND(CAST(JSON_UNQUOTE(JSON_EXTRACT(config_value, '$.PHP')) AS DECIMAL(18,6)) * 1.53 / 100) * 100
       WHEN CAST(JSON_UNQUOTE(JSON_EXTRACT(config_value, '$.PHP')) AS DECIMAL(18,6)) * 1.53 >= 100  THEN ROUND(CAST(JSON_UNQUOTE(JSON_EXTRACT(config_value, '$.PHP')) AS DECIMAL(18,6)) * 1.53 / 10) * 10
       ELSE GREATEST(1, ROUND(CAST(JSON_UNQUOTE(JSON_EXTRACT(config_value, '$.PHP')) AS DECIMAL(18,6)) * 1.53)) END)
WHERE promo_id = 'redep_regular' AND config_key = 'daily_bonus_caps'
  AND JSON_VALID(config_value)
  AND JSON_EXTRACT(config_value, '$.PHP') IS NOT NULL
  AND JSON_EXTRACT(config_value, '$.INR') IS NULL;

-- ── 提现审核阈值：补 INR，缺失会让印度站按 PHP 阈值判定，几乎单单触发大额审核 ──
UPDATE bg_withdraw_review_config
SET params = JSON_SET(COALESCE(params, JSON_OBJECT()), '$.inr',
  ROUND(COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(params, '$.php')) AS DECIMAL(18,2)), threshold, 0) * 1.53 / 100) * 100)
WHERE rule_code IN ('large_amount', 'large_profit', 'total_bonus')
  AND JSON_EXTRACT(COALESCE(params, JSON_OBJECT()), '$.inr') IS NULL;

UPDATE bg_withdraw_review_config
SET params = JSON_SET(COALESCE(params, JSON_OBJECT()), '$.minInr',
  ROUND(COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(params, '$.minPhp')) AS DECIMAL(18,2)), 500) * 1.53 / 10) * 10)
WHERE scope = 'team' AND rule_code IN ('commission_surge', 'fresh_downline_commission', 'commission_deposit_ratio')
  AND JSON_EXTRACT(COALESCE(params, JSON_OBJECT()), '$.minInr') IS NULL;
