-- 印尼团队佣金使用 IDR 钱包和提现记录，菲律宾继续使用 PHP。
ALTER TABLE bg_team_withdrawal
  ADD COLUMN currency VARCHAR(16) NOT NULL DEFAULT 'PHP' AFTER user_id,
  ADD INDEX idx_user_currency_status (user_id, currency, status);

ALTER TABLE bg_team_config
  ADD COLUMN min_withdrawal_idr_cents BIGINT NOT NULL DEFAULT 1440000
    COMMENT '印尼团队佣金最低转入金额（IDR分，默认Rp14,400）' AFTER min_withdrawal_cents,
  ADD COLUMN max_commission_per_settlement_idr_cents BIGINT NULL
    COMMENT '印尼单次结算佣金上限（IDR分，NULL=不限）' AFTER max_commission_per_settlement_cents;
