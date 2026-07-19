CREATE TABLE `bg_home_content` (
  `kind` ENUM('banner','card') NOT NULL,
  `slot` INT UNSIGNED NOT NULL,
  `image_key` VARCHAR(255) NOT NULL,
  `action_type` ENUM('promo','cashback','spin','lobby','none') NOT NULL DEFAULT 'none',
  `action_value` VARCHAR(64) NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`kind`, `slot`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
