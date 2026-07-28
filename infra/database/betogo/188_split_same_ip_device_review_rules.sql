-- 188: 审核策略拆分 same_ip_device 为 IP / 设备ID / 设备指纹三条独立规则
SET NAMES utf8mb4;

INSERT IGNORE INTO bg_withdraw_review_config (rule_code, scope, enabled, threshold, params)
SELECT 'same_ip', scope, enabled, COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(params, '$.ip')) AS DECIMAL(18,4)), 3), NULL
  FROM bg_withdraw_review_config
 WHERE rule_code = 'same_ip_device';

INSERT IGNORE INTO bg_withdraw_review_config (rule_code, scope, enabled, threshold, params)
SELECT 'same_device_id', scope, enabled, COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(params, '$.device')) AS DECIMAL(18,4)), 2), NULL
  FROM bg_withdraw_review_config
 WHERE rule_code = 'same_ip_device';

INSERT IGNORE INTO bg_withdraw_review_config (rule_code, scope, enabled, threshold, params)
SELECT 'same_device_fp', scope, enabled, COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(params, '$.device')) AS DECIMAL(18,4)), 2), NULL
  FROM bg_withdraw_review_config
 WHERE rule_code = 'same_ip_device';

DELETE FROM bg_withdraw_review_config
 WHERE rule_code = 'same_ip_device';
