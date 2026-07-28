-- 187: 提现实名/收款信息审核规则
-- 仅新增审核规则配置，不修改业务数据。
SET NAMES utf8mb4;

INSERT IGNORE INTO bg_withdraw_review_config (rule_code, scope, enabled, threshold, params) VALUES
  ('kyc_name_mismatch',       'user', 1, NULL, NULL),
  ('withdraw_account_reuse',  'user', 1, 1,    NULL),
  ('withdraw_owner_reuse',    'user', 1, 2,    NULL),
  ('fast_withdraw_after_kyc', 'user', 1, 10,   NULL);
