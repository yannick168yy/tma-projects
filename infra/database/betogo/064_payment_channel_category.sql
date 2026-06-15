-- 支付渠道分类：法币 / 虚拟币，并把虚拟币渠道纳入后台开关管理
ALTER TABLE payment_channels
  ADD COLUMN category VARCHAR(10) NOT NULL DEFAULT 'fiat' COMMENT 'fiat | crypto';

-- 播种虚拟币 / TG 渠道（name 与前端方法 id 对应，enabled 沿用当前前端默认）
-- INSERT IGNORE + UNIQUE(name,provider) 保证幂等，不会覆盖后台后续改的开关
INSERT IGNORE INTO payment_channels (name, provider, label, enabled, sort_order, category) VALUES
  ('tg_wallet_php',        'tg_wallet',   'Telegram 钱包 (PHP)',     0, 10, 'crypto'),
  ('tg_wallet_usdt',       'tg_wallet',   'Telegram 钱包 (USDT)',    0, 11, 'crypto'),
  ('ton',                  'ton_connect', 'TON',                     1, 20, 'crypto'),
  ('matrix_tlk_testnet',   'matrix',      'Matrix TLK 充值 (测试)',  1, 30, 'crypto'),
  ('matrix_trx_testnet',   'matrix',      'Matrix TRX 充值 (测试)',  1, 31, 'crypto'),
  ('usdt-trc',             'manual',      'USDT TRC20 充值',         0, 40, 'crypto'),
  ('usdt-trc-w',           'manual',      'USDT TRC20 提现',         1, 50, 'crypto'),
  ('usdt-erc-w',           'manual',      'USDT ERC20 提现',         1, 51, 'crypto'),
  ('ton-w',                'manual',      'TON 提现',                1, 52, 'crypto'),
  ('btc-w',                'manual',      'Bitcoin 提现',            1, 53, 'crypto'),
  ('matrix_tlk_testnet_w', 'matrix',      'Matrix TLK 提现 (测试)',  1, 60, 'crypto'),
  ('matrix_trx_testnet_w', 'matrix',      'Matrix TRX 提现 (测试)',  1, 61, 'crypto');
