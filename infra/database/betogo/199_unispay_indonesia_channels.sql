-- 199: UnisPay 印尼 IDR 法币充提渠道播种
-- 默认关闭，避免未配置商户密钥时前台放出真实入口；上线前由后台逐个启用。

INSERT IGNORE INTO payment_channels (name, provider, label, enabled, sort_order, category) VALUES
  ('bri',       'unispay', 'BRI - UnisPay',       0, 201, 'fiat'),
  ('bca',       'unispay', 'BCA - UnisPay',       0, 202, 'fiat'),
  ('bni',       'unispay', 'BNI - UnisPay',       0, 203, 'fiat'),
  ('mandiri',   'unispay', 'Mandiri - UnisPay',   0, 204, 'fiat'),
  ('dana',      'unispay', 'DANA - UnisPay',      0, 211, 'fiat'),
  ('ovo',       'unispay', 'OVO - UnisPay',       0, 212, 'fiat'),
  ('gopay',     'unispay', 'GoPay - UnisPay',     0, 213, 'fiat'),
  ('shopeepay', 'unispay', 'ShopeePay - UnisPay', 0, 214, 'fiat'),
  ('qris',      'unispay', 'QRIS - UnisPay',      0, 221, 'fiat');

INSERT INTO payment_channel_rules (channel_id, currency, tx_type, amount_min, amount_max, weight, enabled)
SELECT c.id, 'IDR', 'deposit', 10000, 100000000, 100, 1
FROM payment_channels c
WHERE c.provider = 'unispay'
  AND c.name IN ('bri','bca','bni','mandiri','dana','ovo','gopay','shopeepay','qris')
  AND NOT EXISTS (
    SELECT 1 FROM payment_channel_rules r
    WHERE r.channel_id = c.id AND r.currency = 'IDR' AND r.tx_type = 'deposit'
  );

INSERT INTO payment_channel_rules (channel_id, currency, tx_type, amount_min, amount_max, weight, enabled)
SELECT c.id, 'IDR', 'withdraw', 10000, 100000000, 100, 1
FROM payment_channels c
WHERE c.provider = 'unispay'
  AND c.name IN ('bri','bca','bni','mandiri','dana','ovo','gopay','shopeepay')
  AND NOT EXISTS (
    SELECT 1 FROM payment_channel_rules r
    WHERE r.channel_id = c.id AND r.currency = 'IDR' AND r.tx_type = 'withdraw'
  );
