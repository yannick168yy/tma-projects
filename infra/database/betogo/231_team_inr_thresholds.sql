-- 231: 团队（推广联盟）补印度 INR 门槛列。
-- 缺这几列时印度用户会落到 PHP 分支：激活门槛按 ₱100 判 ₹ 金额（约合 ₹150 才该激活，
-- 实际 ₹100 就放过），最低提现同理。数值按 1 PHP = 1.53 INR 换算后取整。
ALTER TABLE bg_team_config
  ADD COLUMN min_activation_inr_cents BIGINT NOT NULL DEFAULT 15000
    COMMENT '印度团队激活门槛（INR分，默认₹150）' AFTER min_activation_idr_cents,
  ADD COLUMN min_withdrawal_inr_cents BIGINT NOT NULL DEFAULT 7700
    COMMENT '印度团队佣金最低转入金额（INR分，默认₹77）' AFTER min_withdrawal_idr_cents,
  ADD COLUMN max_commission_per_settlement_inr_cents BIGINT NULL
    COMMENT '印度单次结算佣金上限（INR分，NULL=不限）' AFTER max_commission_per_settlement_idr_cents;
