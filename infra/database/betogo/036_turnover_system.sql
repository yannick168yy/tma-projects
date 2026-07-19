-- 036: 投注流水系统

-- 游戏大类贡献率配置
CREATE TABLE IF NOT EXISTS `bg_game_turnover_rates` (
  `sort_category` VARCHAR(64)   NOT NULL,
  `rate`          DECIMAL(5,4)  NOT NULL DEFAULT 1.0000 COMMENT '贡献率 0-1',
  `updated_at`    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`sort_category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='游戏大类流水贡献率';

INSERT INTO `bg_game_turnover_rates` (`sort_category`, `rate`) VALUES
  ('slots',   1.0000),
  ('fishing', 1.0000),
  ('live',    1.0000),
  ('bingo',   1.0000),
  ('crash',   1.0000),
  ('table',   1.0000),
  ('pinoy',   1.0000)
ON DUPLICATE KEY UPDATE `rate` = VALUES(`rate`);

-- 流水要求表（每次存款/优惠领取创建一条）
CREATE TABLE IF NOT EXISTS `bg_turnover_requirements` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`          VARCHAR(32)     NOT NULL,
  `source_type`      ENUM('deposit','promotion') NOT NULL,
  `source_ref`       VARCHAR(128)    NOT NULL COMMENT '存款 orderId 或优惠类型(trial/referral/firstdep)',
  `required_amount`  DECIMAL(18,4)   NOT NULL,
  `completed_amount` DECIMAL(18,4)   NOT NULL DEFAULT 0,
  `status`           ENUM('pending','completed','expired','cancelled') NOT NULL DEFAULT 'pending',
  `expires_at`       DATETIME        NULL     COMMENT '仅优惠类要求有有效期，NULL=永久',
  `created_at`       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_user_status` (`user_id`, `status`),
  KEY `idx_expires`     (`expires_at`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户流水要求';

-- 投注流水明细（每笔 bet 类型的投注产生一条）
CREATE TABLE IF NOT EXISTS `bg_turnover_logs` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`          VARCHAR(32)     NOT NULL,
  `bet_order_id`     BIGINT UNSIGNED NOT NULL COMMENT '关联 bg_bet_order.id',
  `bet_amount`       DECIMAL(18,4)   NOT NULL,
  `rate`             DECIMAL(5,4)    NOT NULL DEFAULT 1.0000,
  `effective_amount` DECIMAL(18,4)   NOT NULL COMMENT 'bet_amount * rate，实际计入的流水额',
  `sort_category`    VARCHAR(64)     NULL,
  `is_reversed`      TINYINT(1)      NOT NULL DEFAULT 0,
  `created_at`       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bet_order` (`bet_order_id`),
  KEY `idx_user_created` (`user_id`, `created_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='投注流水明细';

-- 流水分配表（叠加模式：一笔投注流水按 FIFO 拆分到各要求）
CREATE TABLE IF NOT EXISTS `bg_turnover_allocations` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `log_id`           BIGINT UNSIGNED NOT NULL,
  `requirement_id`   BIGINT UNSIGNED NOT NULL,
  `allocated_amount` DECIMAL(18,4)   NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_log`         (`log_id`),
  KEY `idx_requirement` (`requirement_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='流水要求分配明细';

-- 为 trial/referral 补充 turnover_x 和 turnover_days；INSERT IGNORE 避免每次部署覆盖管理员手动调整的值
INSERT IGNORE INTO `bg_promo_config` (`promo_id`, `config_key`, `config_value`) VALUES
  ('trial',    'turnover_x',    '15'),
  ('trial',    'turnover_days', '0'),
  ('referral', 'turnover_x',    '15'),
  ('referral', 'turnover_days', '0'),
  ('firstdep', 'turnover_days', '30');
