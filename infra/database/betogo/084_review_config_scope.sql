-- 084: 审核策略按业务域拆分——玩家提款(user) 与 佣金提现(team) 各自一套规则配置
-- 原表主键为 rule_code（单套配置，两类提现共用）。改为 (scope, rule_code)，
-- 现有行默认归入 user 域，玩家提款原阈值/开关原样保留；再为 team 域插入默认配置。

ALTER TABLE bg_withdraw_review_config
  ADD COLUMN scope VARCHAR(16) NOT NULL DEFAULT 'user'
    COMMENT '业务域: user(玩家提款) | team(佣金提现)' AFTER rule_code,
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (scope, rule_code);

-- 佣金提现(team)默认配置：仅团队侧实际使用的 7 条规则，阈值偏宽松
INSERT IGNORE INTO bg_withdraw_review_config (rule_code, scope, enabled, threshold, params) VALUES
  ('large_amount',             'team', 1, NULL, JSON_OBJECT('phpCents', 5000000)),
  ('deposit_source',           'team', 1, NULL, NULL),
  ('first_withdraw_no_deposit','team', 1, NULL, NULL),
  ('upline_blacklist',         'team', 1, NULL, NULL),
  ('same_ip_device',           'team', 1, NULL, JSON_OBJECT('ip', 3)),
  ('tampered_bet',             'team', 1, NULL, NULL),
  ('commission_anomaly',       'team', 1, NULL, NULL);
