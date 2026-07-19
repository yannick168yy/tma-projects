-- 支付渠道手续费配置：用于服务商余额与我方记账对账
ALTER TABLE payment_channels
  ADD COLUMN deposit_fee_type VARCHAR(10) NOT NULL DEFAULT 'none' COMMENT 'none | percent | fixed' AFTER category,
  ADD COLUMN deposit_fee_value DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER deposit_fee_type,
  ADD COLUMN withdraw_fee_type VARCHAR(10) NOT NULL DEFAULT 'none' AFTER deposit_fee_value,
  ADD COLUMN withdraw_fee_value DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER withdraw_fee_type;

-- YFPay 当前费率：代收 GCash 1.1%，Maya 0.65%；代付每笔 4.3 PHP
UPDATE payment_channels
SET deposit_fee_type = 'percent', deposit_fee_value = 0.011000
WHERE provider = 'yfpay' AND name = 'gcash';

UPDATE payment_channels
SET deposit_fee_type = 'percent', deposit_fee_value = 0.006500
WHERE provider = 'yfpay' AND name = 'maya';

UPDATE payment_channels
SET withdraw_fee_type = 'fixed', withdraw_fee_value = 4.300000
WHERE provider = 'yfpay' AND category = 'fiat';
