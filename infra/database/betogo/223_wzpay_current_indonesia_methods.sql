-- 223: 按 WZPAY 2026-09-10 文档更新印尼可用代收方式及代付编码
-- 新增渠道默认关闭；测试环境确认后单独开启，避免未来生产迁移自动开通。

INSERT INTO payment_channels (name, provider, label, enabled, sort_order, category) VALUES
  ('bni',     'wzpay', 'BNI - WZPAY',     0, 236, 'fiat'),
  ('bri',     'wzpay', 'BRI - WZPAY',     0, 237, 'fiat'),
  ('mandiri', 'wzpay', 'Mandiri - WZPAY', 0, 238, 'fiat'),
  ('permata', 'wzpay', 'Permata - WZPAY', 0, 239, 'fiat')
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  sort_order = VALUES(sort_order),
  category = VALUES(category);

INSERT INTO payment_channel_rules (channel_id, currency, tx_type, amount_min, amount_max, weight, enabled)
SELECT c.id, 'IDR', 'both', NULL, NULL, 100, 1
FROM payment_channels c
WHERE c.provider = 'wzpay'
  AND c.name IN ('bni','bri','mandiri','permata')
  AND NOT EXISTS (
    SELECT 1 FROM payment_channel_rules r
    WHERE r.channel_id = c.id AND r.currency = 'IDR'
  );

UPDATE payment_channel_rules r
JOIN payment_channels c ON c.id = r.channel_id
SET r.tx_type = CASE
  WHEN c.name = 'qris' THEN 'deposit'
  ELSE 'withdraw'
END
WHERE c.provider = 'wzpay'
  AND c.name IN ('dana','qris','linkaja','ovo','gopay')
  AND r.currency = 'IDR';
