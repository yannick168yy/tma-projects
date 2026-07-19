-- 114: 佣金提现审核规则重构——关掉误报规则，加入佣金域专属规则
-- 关：deposit_source / first_withdraw_no_deposit（纯推广型代理不存款是常态，每笔必中转人工）
-- 加：四条针对刷佣攻击面的规则（自我裂变矩阵/速成农场/数学不可能佣金/下线同IP）
SET NAMES utf8mb4;

UPDATE bg_withdraw_review_config SET enabled = 0
 WHERE scope = 'team' AND rule_code IN ('deposit_source', 'first_withdraw_no_deposit');

INSERT IGNORE INTO bg_withdraw_review_config (rule_code, scope, enabled, threshold, params) VALUES
  ('commission_surge',          'team', 1, NULL, JSON_OBJECT('mult', 1.0, 'minCents', 50000)),
  ('fresh_downline_commission', 'team', 1, NULL, JSON_OBJECT('days', 7, 'ratio', 0.6, 'minCents', 50000)),
  ('commission_deposit_ratio',  'team', 1, NULL, JSON_OBJECT('ratio', 0.5, 'minCents', 50000)),
  ('downline_ip_overlap',       'team', 1, 2, NULL);
