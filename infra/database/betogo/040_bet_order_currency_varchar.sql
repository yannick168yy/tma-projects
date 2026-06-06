-- 040: bg_bet_order.currency_code CHAR(3) → VARCHAR(10)
-- CHAR(3) 无法存 USDT/USDC 等 4 字符币种代码
ALTER TABLE bg_bet_order MODIFY COLUMN currency_code VARCHAR(10) NOT NULL DEFAULT 'PHP';
