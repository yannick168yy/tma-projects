-- Match YFPay withdrawal limits returned by the provider.
UPDATE payment_channel_rules r
JOIN payment_channels c ON c.id = r.channel_id
SET r.amount_min = 100.00,
    r.amount_max = 800.00
WHERE c.provider = 'yfpay'
  AND c.name IN ('gcash', 'maya')
  AND r.tx_type IN ('withdraw', 'both');
