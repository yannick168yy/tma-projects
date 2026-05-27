-- 005: user label, last_login_at, login log table (idempotent)

SET @c1 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_user' AND COLUMN_NAME = 'label');
SET @s1 = IF(@c1 = 0, 'ALTER TABLE `bg_user` ADD COLUMN `label` VARCHAR(32) NOT NULL DEFAULT ''normal'' AFTER `status`', 'SELECT 1');
PREPARE st FROM @s1; EXECUTE st; DEALLOCATE PREPARE st;

SET @c2 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_user' AND COLUMN_NAME = 'last_login_at');
SET @s2 = IF(@c2 = 0, 'ALTER TABLE `bg_user` ADD COLUMN `last_login_at` DATETIME(3) NULL', 'SELECT 1');
PREPARE st FROM @s2; EXECUTE st; DEALLOCATE PREPARE st;

CREATE TABLE IF NOT EXISTS `bg_login_log` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     VARCHAR(32)   NOT NULL,
  `ip`          VARCHAR(64)   NULL,
  `user_agent`  VARCHAR(512)  NULL,
  `auth_method` VARCHAR(32)   NOT NULL DEFAULT 'telegram',
  `created_at`  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_user_created` (`user_id`, `created_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
