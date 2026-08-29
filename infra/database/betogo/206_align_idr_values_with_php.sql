-- IDR 初始金额始终参考测试库当前 PHP 配置，按 1 PHP = 287 IDR 换算并取整到百位。
UPDATE bg_promo_config idr
JOIN bg_promo_config php
  ON php.promo_id = idr.promo_id AND php.config_key = 'amount'
SET idr.config_value = CAST(GREATEST(100, ROUND(CAST(php.config_value AS DECIMAL(18,6)) * 287 / 100) * 100) AS CHAR)
WHERE idr.promo_id IN ('trial', 'appdl') AND idr.config_key = 'amount_idr';

UPDATE bg_withdraw_review_config
SET params = JSON_SET(
  COALESCE(params, JSON_OBJECT()),
  '$.idr',
  GREATEST(100, ROUND(COALESCE(
    CAST(JSON_UNQUOTE(JSON_EXTRACT(params, '$.php')) AS DECIMAL(18,6)),
    threshold,
    50000
  ) * 287 / 100) * 100)
)
WHERE rule_code = 'large_amount';
