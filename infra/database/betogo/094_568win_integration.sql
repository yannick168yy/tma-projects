-- 094: 568Win 聚合商接入基础表
SET NAMES utf8mb4;

CREATE TABLE `bg_game_aggregator` (
  `aggregator_id` VARCHAR(32) NOT NULL COMMENT '聚合商标识',
  `name`          VARCHAR(64) NOT NULL COMMENT '聚合商名称',
  `is_primary`    TINYINT(1)  NOT NULL DEFAULT 0 COMMENT '是否主聚合商',
  `is_active`     TINYINT(1)  NOT NULL DEFAULT 1 COMMENT '是否启用',
  `created_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`aggregator_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='游戏聚合商';

INSERT INTO `bg_game_aggregator` (`aggregator_id`, `name`, `is_primary`, `is_active`)
VALUES ('568win', '568Win', 1, 1), ('slotegrator', 'Slotegrator', 0, 1);

CREATE TABLE `bg_568win_agent` (
  `agent_username`     VARCHAR(40)   NOT NULL COMMENT '568Win Agent Username',
  `currency`           VARCHAR(16)   NOT NULL COMMENT 'Agent 币种，创建后不可变',
  `min_bet`            DECIMAL(18,4) NOT NULL,
  `max_bet`            DECIMAL(18,4) NOT NULL,
  `max_bet_per_match`  DECIMAL(18,4) NOT NULL,
  `casino_table_limit` TINYINT       NOT NULL,
  `status`             VARCHAR(16)   NOT NULL DEFAULT 'active',
  `raw_response`       JSON          NULL,
  `created_at`         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`agent_username`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='568Win Agent 映射';

CREATE TABLE `bg_aggregator_player` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `aggregator_id`     VARCHAR(32)     NOT NULL COMMENT '聚合商标识',
  `user_id`           VARCHAR(32)     NOT NULL COMMENT '本地用户ID',
  `external_username` VARCHAR(40)     NOT NULL COMMENT '聚合商玩家账号',
  `agent_username`    VARCHAR(40)     NULL COMMENT '568Win Agent Username',
  `currency`          VARCHAR(16)     NOT NULL DEFAULT 'PHP',
  `status`            VARCHAR(16)     NOT NULL DEFAULT 'active',
  `raw_response`      JSON            NULL,
  `created_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_aggregator_user` (`aggregator_id`, `user_id`),
  UNIQUE KEY `uk_aggregator_username` (`aggregator_id`, `external_username`),
  KEY `idx_user` (`user_id`),
  CONSTRAINT `fk_aggregator_player_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='聚合商玩家账号映射';

CREATE TABLE `bg_568win_wallet_txn` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`           VARCHAR(32)     NOT NULL COMMENT '本地用户ID',
  `external_username` VARCHAR(40)     NOT NULL COMMENT '568Win Username',
  `currency`          VARCHAR(16)     NOT NULL DEFAULT 'PHP',
  `transfer_code`     VARCHAR(128)    NOT NULL COMMENT '568Win TransferCode',
  `transaction_id`    VARCHAR(128)    NULL COMMENT '568Win TransactionId',
  `product_type`      INT             NOT NULL,
  `game_type`         INT             NOT NULL,
  `gpid`              INT             NULL,
  `provider_id`       VARCHAR(64)     NOT NULL DEFAULT '',
  `round_id`          VARCHAR(128)    NULL,
  `txn_type`          ENUM('bet','bonus') NOT NULL,
  `amount`            DECIMAL(18,4)   NOT NULL COMMENT '投注或红利金额',
  `win_loss`          DECIMAL(18,4)   NULL COMMENT 'Settle WinLoss，已含本金',
  `status`            VARCHAR(16)     NOT NULL COMMENT 'running|settled|Void',
  `raw_request`       JSON            NULL,
  `created_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `settled_at`        DATETIME(3)     NULL,
  `voided_at`         DATETIME(3)     NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_transfer_txn` (`transfer_code`, `transaction_id`),
  KEY `idx_user_created` (`user_id`, `created_at` DESC),
  KEY `idx_transfer` (`transfer_code`),
  KEY `idx_status` (`status`),
  CONSTRAINT `fk_568win_txn_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='568Win Seamless Wallet 交易状态';
