-- 568Win 玩家映射支持多币种：同一用户可分别在 PHP / USDT agent 下各有一条映射
-- 原唯一键 (aggregator_id, user_id) 限制了「一个用户只能挂一个币种」，改为带 currency。
-- external_username 仍全局唯一（uk_aggregator_username 不变），USDT 用不同后缀账号避免冲突。
ALTER TABLE `bg_aggregator_player` DROP INDEX `uk_aggregator_user`;
ALTER TABLE `bg_aggregator_player` ADD UNIQUE KEY `uk_aggregator_user_ccy` (`aggregator_id`, `user_id`, `currency`);
