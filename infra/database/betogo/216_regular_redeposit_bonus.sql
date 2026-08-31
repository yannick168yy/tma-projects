-- 常规复充阶梯赠金：充值成功后生成待领取资格，用户确认规则后领取。
SET NAMES utf8mb4;

CREATE TABLE `bg_regular_redep_claim` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `order_id` VARCHAR(64) NOT NULL,
  `user_id` VARCHAR(32) NOT NULL,
  `currency` VARCHAR(16) NOT NULL,
  `deposit_amount` DECIMAL(18,4) NOT NULL,
  `bonus_amount` DECIMAL(18,4) NOT NULL,
  `turnover_x` DECIMAL(8,2) NOT NULL DEFAULT 0,
  `turnover_days` INT NOT NULL DEFAULT 0,
  `status` ENUM('pending','claimed','expired','cancelled','rejected') NOT NULL DEFAULT 'pending',
  `expires_at` DATETIME(3) NOT NULL,
  `claimed_at` DATETIME(3) NULL,
  `ledger_id` VARCHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_regular_redep_order` (`order_id`),
  KEY `idx_regular_redep_user` (`user_id`, `status`, `expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='常规复充赠金待领取资格';

INSERT INTO `bg_promo_config` (`promo_id`, `config_key`, `config_value`) VALUES
  ('redep_regular', 'enabled', '1'),
  ('redep_regular', 'tiers', '{"PHP":[{"depositAmount":500,"bonusAmount":25},{"depositAmount":1000,"bonusAmount":75},{"depositAmount":3000,"bonusAmount":300},{"depositAmount":5000,"bonusAmount":600}],"IDR":[{"depositAmount":143500,"bonusAmount":7200},{"depositAmount":287000,"bonusAmount":21500},{"depositAmount":861000,"bonusAmount":86100},{"depositAmount":1435000,"bonusAmount":172200}],"USDT":[{"depositAmount":8.62,"bonusAmount":0.43},{"depositAmount":17.24,"bonusAmount":1.29},{"depositAmount":51.72,"bonusAmount":5.17},{"depositAmount":86.21,"bonusAmount":10.34}],"USDC":[{"depositAmount":8.62,"bonusAmount":0.43},{"depositAmount":17.24,"bonusAmount":1.29},{"depositAmount":51.72,"bonusAmount":5.17},{"depositAmount":86.21,"bonusAmount":10.34}]}'),
  ('redep_regular', 'turnover_x', '3'),
  ('redep_regular', 'turnover_days', '30'),
  ('redep_regular', 'claim_hours', '24'),
  ('redep_regular', 'daily_max_claims', '3'),
  ('redep_regular', 'daily_bonus_caps', '{"PHP":1200,"IDR":344400,"USDT":20.69,"USDC":20.69}'),
  ('redep_regular', 'stack_with_limited', '0')
ON DUPLICATE KEY UPDATE `config_value` = VALUES(`config_value`);
