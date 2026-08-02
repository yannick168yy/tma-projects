-- 194: 同名审核规则
-- 本人 KYC 实名与其它已通过 KYC 的账号做模糊比对，命中同名的其它账号数 ≥ 阈值即转人工。
-- 仅新增审核规则配置，不修改业务数据。
SET NAMES utf8mb4;

INSERT IGNORE INTO bg_withdraw_review_config (rule_code, scope, enabled, threshold, params) VALUES
  ('same_name_review', 'user', 1, 1, NULL);
