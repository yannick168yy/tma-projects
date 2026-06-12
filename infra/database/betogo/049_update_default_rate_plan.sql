-- 049: 将默认费率套餐调整为 L1=0.6% / L2=0.3% / L3=0.2%
UPDATE `bg_team_rate_plan`
SET `l1_rate_pct` = 0.60, `l2_rate_pct` = 0.30, `l3_rate_pct` = 0.20
WHERE `is_default` = 1;

UPDATE `bg_team_config`
SET `l1_rate_pct` = 0.60, `l2_rate_pct` = 0.30, `l3_rate_pct` = 0.20
WHERE `id` = 1;
