-- USDC 收款渠道已由 Matrix 侧配好（TRON/ETHEREUM 均实测能出真实地址），放开开关
UPDATE payment_channels SET enabled = 1
  WHERE name IN ('matrix_usdc_trc', 'matrix_usdc_erc') AND category = 'crypto';
