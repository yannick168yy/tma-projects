-- /bets 注单历史读加速：每局汇总表，消除按局 GROUP BY + ORDER BY MAX(id) 的临时表+filesort。
-- 由 core-node win568-wallet.service 在下注/结算事务内按 round_id 重算维护(派生数据)。
-- 不回填历史(业务确认历史可弃)：切换后仅新产生的注单进入历史列表。
CREATE TABLE IF NOT EXISTS `bg_bet_round` (
  `id`              bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id`         varchar(32)  NOT NULL,
  `round_id`        varchar(128) NOT NULL COMMENT '局号(568win注单 round_id 恒非空)',
  `aggregator_id`   varchar(32)  NOT NULL DEFAULT '568win',
  `provider_txn_id` varchar(128) DEFAULT NULL COMMENT '本局bet行的provider_txn_id，读时JOIN取游戏名',
  `bet_amount`      decimal(18,4) NOT NULL DEFAULT 0 COMMENT '=SUM(bet_type=bet)',
  `win_amount`      decimal(18,4) NOT NULL DEFAULT 0 COMMENT '=SUM(bet_type in win,refund)',
  `currency_code`   varchar(32)  NOT NULL DEFAULT 'PHP',
  `first_at`        datetime(3)  NOT NULL COMMENT '=MIN(created_at)',
  `last_id`         bigint unsigned NOT NULL COMMENT '=MAX(bg_bet_order.id)，排序键',
  `updated_at`      datetime(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_round` (`user_id`, `round_id`),
  KEY `idx_user_last` (`user_id`, `last_id`),
  KEY `idx_user_first` (`user_id`, `first_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='注单按局汇总(读加速，派生自bg_bet_order)';
