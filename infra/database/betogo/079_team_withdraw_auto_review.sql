-- 079: 佣金提现接入自动审核流程
ALTER TABLE `bg_team_withdrawal`
  ADD COLUMN `review_round` TINYINT UNSIGNED NULL
    COMMENT '当前审核轮次' AFTER `reviewed_at`,
  ADD COLUMN `review_ms` INT NULL
    COMMENT '审核耗时(ms)' AFTER `review_round`,
  ADD COLUMN `review_snapshot` JSON NULL
    COMMENT '审核当时的上下文快照' AFTER `review_ms`;

CREATE TABLE IF NOT EXISTS `bg_team_withdraw_review_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `withdrawal_id` BIGINT UNSIGNED NOT NULL COMMENT '佣金提现 ID',
  `user_id` VARCHAR(32) NOT NULL,
  `rule_code` VARCHAR(40) NOT NULL,
  `round` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '审核轮次',
  `verdict` ENUM('pass','manual','skipped','error') NOT NULL,
  `actual_value` DECIMAL(18,4) NULL,
  `threshold` DECIMAL(18,4) NULL,
  `detail` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_withdrawal_round` (`withdrawal_id`, `round`),
  KEY `idx_rule_time` (`rule_code`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='佣金提现自动审核逐规则结果';
