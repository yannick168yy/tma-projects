-- 006: admin settings table (op password), geo columns on user and login log (idempotent)

CREATE TABLE IF NOT EXISTS `bg_admin_settings` (
  `key`        VARCHAR(64)  NOT NULL,
  `value`      TEXT         NOT NULL,
  `updated_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @c1 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_user' AND COLUMN_NAME = 'register_ip');
SET @s1 = IF(@c1 = 0, 'ALTER TABLE `bg_user` ADD COLUMN `register_ip` VARCHAR(64) NULL', 'SELECT 1');
PREPARE st FROM @s1; EXECUTE st; DEALLOCATE PREPARE st;

SET @c2 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_user' AND COLUMN_NAME = 'register_region');
SET @s2 = IF(@c2 = 0, 'ALTER TABLE `bg_user` ADD COLUMN `register_region` VARCHAR(128) NULL', 'SELECT 1');
PREPARE st FROM @s2; EXECUTE st; DEALLOCATE PREPARE st;

SET @c3 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_login_log' AND COLUMN_NAME = 'region');
SET @s3 = IF(@c3 = 0, 'ALTER TABLE `bg_login_log` ADD COLUMN `region` VARCHAR(128) NULL', 'SELECT 1');
PREPARE st FROM @s3; EXECUTE st; DEALLOCATE PREPARE st;

SET @c4 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_user' AND COLUMN_NAME = 'last_login_ip');
SET @s4 = IF(@c4 = 0, 'ALTER TABLE `bg_user` ADD COLUMN `last_login_ip` VARCHAR(64) NULL', 'SELECT 1');
PREPARE st FROM @s4; EXECUTE st; DEALLOCATE PREPARE st;

SET @c5 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_user' AND COLUMN_NAME = 'last_login_region');
SET @s5 = IF(@c5 = 0, 'ALTER TABLE `bg_user` ADD COLUMN `last_login_region` VARCHAR(128) NULL', 'SELECT 1');
PREPARE st FROM @s5; EXECUTE st; DEALLOCATE PREPARE st;
