-- 241: 印度站提现审核新增「提现户名变更」规则（INR 订单，户名与上一笔成功提现不同转人工）
SET NAMES utf8mb4;

INSERT IGNORE INTO bg_withdraw_review_config (rule_code, scope, enabled, threshold, params) VALUES
  ('withdraw_owner_changed', 'user', 1, NULL, NULL);
