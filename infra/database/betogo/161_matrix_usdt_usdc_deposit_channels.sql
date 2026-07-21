-- Matrix 生产 USDT / USDC 充值渠道（TRON=TRC20，ETH=ERC20）
-- name 与前端 CRYPTO_DEPOSIT 的渠道 id 一一对应，供后台开关管理
-- INSERT IGNORE + UNIQUE(name,provider) 保证幂等，不覆盖后台后续改的开关
-- 链代码：TRON=TRC20、ETHEREUM=ERC20（Matrix 后台确认）
-- USDT 两条链实测能出真实地址→启用；USDC 网关返回 1103「暂无可用的支付渠道」→先禁用等 Matrix 配好收款渠道
INSERT IGNORE INTO payment_channels (name, provider, label, enabled, sort_order, category) VALUES
  ('matrix_usdt_trc', 'matrix', 'USDT TRC20 充值', 1, 32, 'crypto'),
  ('matrix_usdt_erc', 'matrix', 'USDT ERC20 充值', 1, 33, 'crypto'),
  ('matrix_usdc_trc', 'matrix', 'USDC TRC20 充值', 0, 34, 'crypto'),
  ('matrix_usdc_erc', 'matrix', 'USDC ERC20 充值', 0, 35, 'crypto');
