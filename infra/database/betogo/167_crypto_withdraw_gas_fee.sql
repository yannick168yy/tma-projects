-- 虚拟币提现 gas 费：用户在取款额之外额外承担，从钱包多扣、链上到账不含 gas。
-- 单位 = 币种本身；0 = 不收。仅用于 category='crypto' 的提现渠道（matrix_usdt_w / matrix_usdc_w 等）。
ALTER TABLE payment_channels
  ADD COLUMN withdraw_gas_fee DECIMAL(18,8) NOT NULL DEFAULT 0 COMMENT '虚拟币提现用户额外承担的gas费(币种单位)';
