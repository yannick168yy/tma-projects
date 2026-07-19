-- 删除遗留死表：043 已处理过，保留本迁移用于未完整执行历史迁移的环境兜底。
DROP TABLE IF EXISTS bg_promo_claim;
DROP TABLE IF EXISTS bg_game_session;
