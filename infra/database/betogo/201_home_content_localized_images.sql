CREATE TABLE IF NOT EXISTS `bg_home_content_image` (
  `kind` ENUM('banner','card','wallet_banner') NOT NULL,
  `slot` INT UNSIGNED NOT NULL,
  `locale` VARCHAR(16) NOT NULL,
  `image_key` VARCHAR(255) NOT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`kind`, `slot`, `locale`),
  CONSTRAINT `fk_home_content_image_item`
    FOREIGN KEY (`kind`, `slot`) REFERENCES `bg_home_content` (`kind`, `slot`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
