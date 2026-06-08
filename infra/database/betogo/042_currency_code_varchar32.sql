-- 042: 币种代码扩至 VARCHAR(32)，防止用户传入超长 currency 字符串导致 SG 回调 INSERT 失败
-- 幂等：当前已是 32 则 MODIFY 无操作
ALTER TABLE bg_bet_order MODIFY COLUMN currency_code VARCHAR(32) NOT NULL DEFAULT 'PHP';
