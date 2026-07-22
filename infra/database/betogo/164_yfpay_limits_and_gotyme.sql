-- 164: YFPay 充提限额放开 + 新增 GoTyme 支付线
-- 1) gcash / maya 的生效规则（tx_type='both'）单笔区间 100~800 放开到 100~50000（充值、提现一致）。
UPDATE payment_channel_rules r
JOIN payment_channels c ON c.id = r.channel_id
SET r.amount_min = 100.00,
    r.amount_max = 50000.00
WHERE c.provider = 'yfpay'
  AND c.name IN ('gcash', 'maya')
  AND r.tx_type = 'both';

-- 2) 新增 GoTyme 渠道（YFPay：代收 code=GoTyme-ty，代付 optionCode=161548）。
INSERT INTO payment_channels (name, provider, label, category, enabled, sort_order)
VALUES ('gotyme', 'yfpay', 'GoTyme', 'fiat', 1, 30)
ON DUPLICATE KEY UPDATE label = VALUES(label), enabled = VALUES(enabled);

-- 3) GoTyme 充提规则 100~50000（tx_type='both'）；NOT EXISTS 防止重复插入。
INSERT INTO payment_channel_rules (channel_id, currency, tx_type, amount_min, amount_max, weight, enabled)
SELECT c.id, 'PHP', 'both', 100.00, 50000.00, 100, 1
FROM payment_channels c
WHERE c.name = 'gotyme' AND c.provider = 'yfpay'
  AND NOT EXISTS (
    SELECT 1 FROM payment_channel_rules r
    WHERE r.channel_id = c.id AND r.tx_type = 'both' AND r.currency = 'PHP'
  );
