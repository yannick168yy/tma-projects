-- 228: Huitone 印度 INR 代收代付渠道
-- 商户白名单、密钥和印度市场尚未完成联调，因此渠道默认关闭。

INSERT INTO payment_channels (name, provider, label, enabled, sort_order, category) VALUES
  ('upi',  'huitone', 'UPI - Huitone',           0, 241, 'fiat'),
  ('bank', 'huitone', 'Bank Transfer - Huitone', 0, 242, 'fiat')
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  sort_order = VALUES(sort_order),
  category = VALUES(category);

INSERT INTO payment_channel_rules (channel_id, currency, tx_type, amount_min, amount_max, weight, enabled)
SELECT c.id, 'INR',
  CASE WHEN c.name = 'upi' THEN 'deposit' ELSE 'withdraw' END,
  NULL, NULL, 100, 1
FROM payment_channels c
WHERE c.provider = 'huitone'
  AND c.name IN ('upi', 'bank')
  AND NOT EXISTS (
    SELECT 1 FROM payment_channel_rules r
    WHERE r.channel_id = c.id AND r.currency = 'INR'
  );
