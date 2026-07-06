-- 115: 清理已下线虚拟币的存量配置行（TON / BTC / TLK 测试链渠道 + TON/TRX 首充档）
-- 背景：064 曾种入 ton / matrix_tlk_testnet(_w) / ton-w / btc-w 渠道，082 曾种入 TON/TRX 首充档。
-- 现已移除这些币种业务，需删除已上线库里的存量行（064/082 seed 已同步删除，仅影响新库）。
-- 说明：仅删除精确指定的配置行(非业务数据)，且迁移只执行一次(schema_migrations 记录版本)，不会误伤。

DELETE FROM payment_channels
 WHERE name IN ('ton', 'matrix_tlk_testnet', 'matrix_tlk_testnet_w', 'ton-w', 'btc-w');

DELETE FROM bg_firstdep_tiers
 WHERE currency IN ('TON', 'TRX');
