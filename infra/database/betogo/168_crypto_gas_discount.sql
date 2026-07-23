-- 虚拟币提现 gas 优惠档位：输入取款金额大于门槛时使用优惠 gas。
ALTER TABLE payment_channels
  ADD COLUMN withdraw_gas_discount_threshold DECIMAL(18, 8) NULL COMMENT '虚拟币提现 gas 优惠门槛，NULL=无优惠档位' AFTER withdraw_gas_fee,
  ADD COLUMN withdraw_gas_discount_fee DECIMAL(18, 8) NULL COMMENT '虚拟币提现优惠 gas 费，NULL=无优惠档位' AFTER withdraw_gas_discount_threshold;

UPDATE payment_channels
SET withdraw_gas_fee = 1.5,
    withdraw_gas_discount_threshold = 50,
    withdraw_gas_discount_fee = 1.2,
    withdraw_min = NULL,
    withdraw_max = NULL
WHERE category = 'crypto'
  AND name IN ('matrix_usdt_w', 'matrix_usdc_w');
