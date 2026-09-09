-- 222: WZPAY 印尼 IDR 法币充提渠道播种
-- 文档未提供费率与单笔限额，且商户密钥尚未配置，因此默认关闭。

INSERT INTO payment_channels (name, provider, label, enabled, sort_order, category) VALUES
  ('dana',    'wzpay', 'DANA - WZPAY',    0, 231, 'fiat'),
  ('qris',    'wzpay', 'QRIS - WZPAY',    0, 232, 'fiat'),
  ('linkaja', 'wzpay', 'LinkAja - WZPAY', 0, 233, 'fiat'),
  ('ovo',     'wzpay', 'OVO - WZPAY',     0, 234, 'fiat'),
  ('gopay',   'wzpay', 'GoPay - WZPAY',   0, 235, 'fiat')
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  sort_order = VALUES(sort_order),
  category = VALUES(category);

INSERT INTO payment_channel_rules (channel_id, currency, tx_type, amount_min, amount_max, weight, enabled)
SELECT c.id, 'IDR',
  CASE
    WHEN c.name = 'qris' THEN 'deposit'
    WHEN c.name = 'gopay' THEN 'withdraw'
    ELSE 'both'
  END,
  NULL, NULL, 100, 1
FROM payment_channels c
WHERE c.provider = 'wzpay'
  AND c.name IN ('dana','qris','linkaja','ovo','gopay')
  AND NOT EXISTS (
    SELECT 1 FROM payment_channel_rules r
    WHERE r.channel_id = c.id AND r.currency = 'IDR'
  );
