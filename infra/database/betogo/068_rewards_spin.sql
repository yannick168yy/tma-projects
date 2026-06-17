CREATE TABLE `bg_spin_config` (
  `id` TINYINT UNSIGNED NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='转盘抽奖全局配置';

INSERT INTO `bg_spin_config` (`id`, `enabled`) VALUES (1, 1);

CREATE TABLE `bg_spin_deposit_rule` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `min_deposit_php` DECIMAL(18,4) NOT NULL,
  `chances` INT UNSIGNED NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_enabled_sort` (`enabled`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='转盘抽奖存款发放规则';

INSERT INTO `bg_spin_deposit_rule` (`min_deposit_php`, `chances`, `enabled`, `sort_order`) VALUES
  (108.0000, 1, 1, 10),
  (580.0000, 2, 1, 20),
  (1080.0000, 3, 1, 30);

CREATE TABLE `bg_spin_prize` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(64) NOT NULL,
  `amount_php` DECIMAL(18,4) NOT NULL,
  `weight` INT UNSIGNED NOT NULL,
  `turnover_x` DECIMAL(8,2) NOT NULL DEFAULT 1.00,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_enabled_sort` (`enabled`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='转盘抽奖奖品配置';

INSERT INTO `bg_spin_prize` (`name`, `amount_php`, `weight`, `turnover_x`, `enabled`, `sort_order`) VALUES
  ('₱7.77', 7.7700, 4200, 1.00, 1, 10),
  ('₱17.77', 17.7700, 2600, 1.00, 1, 20),
  ('₱77.77', 77.7700, 900, 3.00, 1, 30),
  ('₱277.77', 277.7700, 250, 5.00, 1, 40),
  ('₱777.77', 777.7700, 45, 8.00, 1, 50),
  ('₱7,777', 7777.0000, 5, 15.00, 1, 60);

CREATE TABLE `bg_spin_chance` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_order_id` VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `deposit_amount_php` DECIMAL(18,4) NOT NULL,
  `chances_total` INT UNSIGNED NOT NULL,
  `chances_used` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_source_order` (`source_order_id`),
  KEY `idx_user_available` (`user_id`, `chances_used`, `chances_total`),
  CONSTRAINT `fk_spin_chance_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='转盘抽奖机会账本';

CREATE TABLE `bg_spin_record` (
  `id` VARCHAR(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `chance_id` BIGINT UNSIGNED NOT NULL,
  `prize_id` BIGINT UNSIGNED NOT NULL,
  `prize_name` VARCHAR(64) NOT NULL,
  `amount_php` DECIMAL(18,4) NOT NULL,
  `turnover_x` DECIMAL(8,2) NOT NULL DEFAULT 1.00,
  `ledger_id` VARCHAR(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_user_created` (`user_id`, `created_at` DESC),
  KEY `idx_created` (`created_at` DESC),
  CONSTRAINT `fk_spin_record_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`),
  CONSTRAINT `fk_spin_record_chance` FOREIGN KEY (`chance_id`) REFERENCES `bg_spin_chance` (`id`),
  CONSTRAINT `fk_spin_record_prize` FOREIGN KEY (`prize_id`) REFERENCES `bg_spin_prize` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='转盘抽奖中奖记录';
