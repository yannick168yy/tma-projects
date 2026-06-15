-- 为支付策略规则加入交易类型字段（充值/提现）
ALTER TABLE payment_channel_rules
  ADD COLUMN tx_type ENUM('deposit', 'withdraw', 'both') NOT NULL DEFAULT 'both'
  AFTER currency;
