-- P1-14 套餐可覆盖范围种子。
--
-- 区间是「租户后台能把这个参数改到多少」的边界，不是默认值。
-- 未登记的 config_key 一律放行（白名单语义：平台没表态就是不管），
-- 所以这里只收录真正影响商务结算的几个。
--
-- 档次差异体现在返水与彩金成本上：标准版收得紧，旗舰版给足。
-- 自营站挂旗舰版，走的是和客户站完全相同的校验链路（不做特例分支）。

INSERT INTO `pf_plan_override` (`plan_id`, `config_key`, `min_value`, `max_value`)
SELECT p.id, v.k, v.mn, v.mx FROM `pf_plan` p JOIN (
  SELECT 'standard' AS plan, 'rebate_rate_pct' AS k, 0 AS mn, 1.5 AS mx UNION ALL
  SELECT 'standard', 'rebate_max_bonus',  0,    50000 UNION ALL
  SELECT 'standard', 'withdraw_min',      50,   100000 UNION ALL
  SELECT 'standard', 'withdraw_max',      100,  500000 UNION ALL
  SELECT 'standard', 'bonus_wager_mult',  1,    20 UNION ALL

  SELECT 'advanced', 'rebate_rate_pct',   0,    2.5 UNION ALL
  SELECT 'advanced', 'rebate_max_bonus',  0,    200000 UNION ALL
  SELECT 'advanced', 'withdraw_min',      20,   200000 UNION ALL
  SELECT 'advanced', 'withdraw_max',      100,  2000000 UNION ALL
  SELECT 'advanced', 'bonus_wager_mult',  0.5,  30 UNION ALL

  SELECT 'flagship', 'rebate_rate_pct',   0,    5 UNION ALL
  SELECT 'flagship', 'rebate_max_bonus',  0,    1000000 UNION ALL
  SELECT 'flagship', 'withdraw_min',      0,    1000000 UNION ALL
  SELECT 'flagship', 'withdraw_max',      0,    100000000 UNION ALL
  SELECT 'flagship', 'bonus_wager_mult',  0,    100
) v ON v.plan = p.code
ON DUPLICATE KEY UPDATE `min_value` = VALUES(`min_value`), `max_value` = VALUES(`max_value`);
