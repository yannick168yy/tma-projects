-- 虚拟币提现每笔限额：给 payment_channels 增加提现最低/最高额度
-- NULL = 不限制，单位 = 币种本身（如 USDT）。仅用于 category='crypto' 的提现渠道；
-- 法币仍走 payment_channel_rules 的 amount_min/amount_max 区间。
ALTER TABLE payment_channels
  ADD COLUMN withdraw_min DECIMAL(18,2) NULL COMMENT '虚拟币单笔提现最低额(NULL=不限)',
  ADD COLUMN withdraw_max DECIMAL(18,2) NULL COMMENT '虚拟币单笔提现最高额(NULL=不限)';

-- 播种 Matrix 按币种的提现渠道，name 与后端 matrix_${symbol}_w 校验键一致，
-- 供后台配置开关 + 每笔限额。enabled=1 保持现有 fail-open 放行行为不变；限额留空=暂不限制。
INSERT IGNORE INTO payment_channels (name, provider, label, enabled, sort_order, category) VALUES
  ('matrix_usdt_w', 'matrix', 'USDT 提现', 1, 52, 'crypto'),
  ('matrix_usdc_w', 'matrix', 'USDC 提现', 1, 53, 'crypto');
