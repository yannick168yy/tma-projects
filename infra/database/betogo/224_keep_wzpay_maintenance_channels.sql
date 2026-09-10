-- 224: 保留 WZPAY DANA/VA 代收配置，维护期间不参与代收路由

INSERT INTO payment_channels (name, provider, label, enabled, sort_order, category) VALUES
  ('va', 'wzpay', 'VA - WZPAY', 0, 240, 'fiat')
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  sort_order = VALUES(sort_order),
  category = VALUES(category);

INSERT INTO payment_channel_rules (channel_id, currency, tx_type, amount_min, amount_max, weight, enabled)
SELECT c.id, 'IDR', 'deposit', NULL, NULL, 100, 1
FROM payment_channels c
WHERE c.provider = 'wzpay'
  AND c.name = 'va'
  AND NOT EXISTS (
    SELECT 1 FROM payment_channel_rules r
    WHERE r.channel_id = c.id AND r.currency = 'IDR'
  );

UPDATE payment_channel_rules r
JOIN payment_channels c ON c.id = r.channel_id
SET r.tx_type = 'withdraw'
WHERE c.provider = 'wzpay'
  AND c.name = 'dana'
  AND r.currency = 'IDR';

UPDATE payment_channels
SET enabled = 0
WHERE provider = 'wzpay'
  AND name = 'va';
