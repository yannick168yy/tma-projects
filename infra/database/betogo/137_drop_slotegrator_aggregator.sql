-- 下线 Slotegrator 聚合商（业务已整体退役：sg_games 迁移110已drop、sg_settlement_report 078已drop、源码集成早已移除）
-- 清理 094 播种的 slotegrator 配置行；精确 WHERE 的一次性删除，schema_migrations 保证本文件只执行一次
-- 注：bg_bet_order 中 aggregator_id='slotegrator' 的历史注单为财务记录，保留不动
DELETE FROM bg_game_aggregator WHERE aggregator_id = 'slotegrator';
