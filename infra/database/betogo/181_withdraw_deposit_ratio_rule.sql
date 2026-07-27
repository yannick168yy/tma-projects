-- 181: 新审核规则 withdraw_deposit_ratio（取款存款倍数）
-- 背景：生产 BG-10213 存 110 试提 5000（45x），赢利经 568Win/PG 老虎机 bonus 通道套现，
--       profit 口径看不见（显示净亏），仅靠 same_ip_device 侥幸拦住。新增一条不依赖盈利口径的闸：
--       本次取款额 ÷ 历史累计真实存款 ≥ threshold 倍即转人工。默认 5，运营可在后台调。
SET NAMES utf8mb4;

INSERT IGNORE INTO bg_withdraw_review_config (rule_code, scope, enabled, threshold, params) VALUES
  ('withdraw_deposit_ratio', 'user', 1, 5, NULL);
