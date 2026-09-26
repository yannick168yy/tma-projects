-- Huitone 已确认 INR 代收、代付单笔范围均为 100～50,000。
UPDATE payment_channel_rules r
JOIN payment_channels c ON c.id = r.channel_id
SET r.amount_min = 100,
    r.amount_max = 50000
WHERE c.provider = 'huitone'
  AND c.name IN ('upi', 'bank')
  AND r.currency = 'INR';
