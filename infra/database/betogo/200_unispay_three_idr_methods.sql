-- 200: 收窄 UnisPay 印尼通道为 QRIS / DANA / VA，并修正单笔限额

DELETE c
FROM payment_channels c
WHERE c.provider = 'unispay'
  AND c.name NOT IN ('qris','dana','va');

INSERT INTO payment_channels (name, provider, label, enabled, sort_order, category) VALUES
  ('qris', 'unispay', 'QRIS - UnisPay', 0, 201, 'fiat'),
  ('dana', 'unispay', 'DANA - UnisPay', 0, 202, 'fiat'),
  ('va',   'unispay', 'VA - UnisPay',   0, 203, 'fiat')
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  sort_order = VALUES(sort_order),
  category = VALUES(category);

UPDATE payment_channel_rules r
JOIN payment_channels c ON c.id = r.channel_id
SET
  r.amount_min = CASE c.name
    WHEN 'qris' THEN 1
    WHEN 'dana' THEN 1000
    WHEN 'va' THEN 10000
  END,
  r.amount_max = CASE c.name
    WHEN 'qris' THEN 2000000
    WHEN 'dana' THEN 20000000
    WHEN 'va' THEN 2000000
  END,
  r.weight = 100,
  r.enabled = 1
WHERE c.provider = 'unispay'
  AND c.name IN ('qris','dana','va')
  AND r.currency = 'IDR'
  AND r.tx_type = 'deposit';

INSERT INTO payment_channel_rules (channel_id, currency, tx_type, amount_min, amount_max, weight, enabled)
SELECT c.id, 'IDR', 'deposit',
  CASE c.name WHEN 'qris' THEN 1 WHEN 'dana' THEN 1000 WHEN 'va' THEN 10000 END,
  CASE c.name WHEN 'qris' THEN 2000000 WHEN 'dana' THEN 20000000 WHEN 'va' THEN 2000000 END,
  100,
  1
FROM payment_channels c
WHERE c.provider = 'unispay'
  AND c.name IN ('qris','dana','va')
  AND NOT EXISTS (
    SELECT 1 FROM payment_channel_rules r
    WHERE r.channel_id = c.id AND r.currency = 'IDR' AND r.tx_type = 'deposit'
  );

UPDATE payment_channel_rules r
JOIN payment_channels c ON c.id = r.channel_id
SET
  r.amount_min = 10000,
  r.amount_max = 2000000,
  r.weight = 100,
  r.enabled = 1
WHERE c.provider = 'unispay'
  AND c.name IN ('qris','dana','va')
  AND r.currency = 'IDR'
  AND r.tx_type = 'withdraw';

INSERT INTO payment_channel_rules (channel_id, currency, tx_type, amount_min, amount_max, weight, enabled)
SELECT c.id, 'IDR', 'withdraw', 10000, 2000000, 100, 1
FROM payment_channels c
WHERE c.provider = 'unispay'
  AND c.name IN ('qris','dana','va')
  AND NOT EXISTS (
    SELECT 1 FROM payment_channel_rules r
    WHERE r.channel_id = c.id AND r.currency = 'IDR' AND r.tx_type = 'withdraw'
  );
