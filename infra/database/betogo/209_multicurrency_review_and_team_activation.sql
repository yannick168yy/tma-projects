-- 审核策略补齐 PHP、IDR、USDT/USDC 独立金额阈值，并为印尼团队激活增加 IDR 门槛。
ALTER TABLE bg_team_config
  ADD COLUMN min_activation_idr_cents BIGINT NOT NULL DEFAULT 2870000
    COMMENT '印尼团队激活门槛（IDR分，默认Rp28,700）' AFTER min_activation_cents;

ALTER TABLE bg_team_node
  ADD COLUMN activation_currency VARCHAR(16) NOT NULL DEFAULT 'PHP'
    COMMENT '激活首充币种' AFTER activation_cents;

UPDATE bg_withdraw_review_config
SET params = JSON_SET(
  COALESCE(params, JSON_OBJECT()),
  '$.php', COALESCE(threshold, 0),
  '$.idr', ROUND(COALESCE(threshold, 0) * 287 / 100) * 100,
  '$.usdt', ROUND(COALESCE(threshold, 0) / 58, 2)
)
WHERE scope = 'user' AND rule_code IN ('large_profit', 'total_bonus');

UPDATE bg_withdraw_review_config
SET params = JSON_SET(
  COALESCE(params, JSON_OBJECT()),
  '$.php', COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(params, '$.php')) AS DECIMAL(18,2)), threshold, 0),
  '$.idr', COALESCE(
    CAST(JSON_UNQUOTE(JSON_EXTRACT(params, '$.idr')) AS DECIMAL(18,2)),
    ROUND(COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(params, '$.php')) AS DECIMAL(18,2)), threshold, 0) * 287 / 100) * 100
  ),
  '$.usdt', COALESCE(
    CAST(JSON_UNQUOTE(JSON_EXTRACT(params, '$.usdt')) AS DECIMAL(18,2)),
    ROUND(COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(params, '$.php')) AS DECIMAL(18,2)), threshold, 0) / 58, 2)
  )
)
WHERE rule_code = 'large_amount';

UPDATE bg_withdraw_review_config
SET params = JSON_SET(
  COALESCE(params, JSON_OBJECT()),
  '$.minPhp', COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(params, '$.minCents')) AS DECIMAL(18,2)), 50000) / 100,
  '$.minIdr', ROUND((COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(params, '$.minCents')) AS DECIMAL(18,2)), 50000) / 100) * 287 / 100) * 100,
  '$.minUsdt', ROUND((COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(params, '$.minCents')) AS DECIMAL(18,2)), 50000) / 100) / 58, 2)
)
WHERE scope = 'team' AND rule_code IN ('commission_surge', 'fresh_downline_commission', 'commission_deposit_ratio');
