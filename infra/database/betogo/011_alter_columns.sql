-- 004: add telegram_username to bg_user; add is_active to sg_games (idempotent)

SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_user' AND COLUMN_NAME = 'telegram_username'
);
SET @s1 = IF(@c1 = 0,
  'ALTER TABLE `bg_user` ADD COLUMN `telegram_username` VARCHAR(128) NULL AFTER `telegram_user_id`',
  'SELECT 1'
);
PREPARE st FROM @s1; EXECUTE st; DEALLOCATE PREPARE st;

SET @c2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sg_games' AND COLUMN_NAME = 'is_active'
);
SET @s2 = IF(@c2 = 0,
  'ALTER TABLE `sg_games` ADD COLUMN `is_active` TINYINT(1) NOT NULL DEFAULT 1',
  'SELECT 1'
);
PREPARE st FROM @s2; EXECUTE st; DEALLOCATE PREPARE st;
