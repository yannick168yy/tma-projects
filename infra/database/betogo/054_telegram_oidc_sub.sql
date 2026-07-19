-- 054: Telegram 网页登录(OIDC) 的 sub 独立字段
-- Telegram OIDC 的 sub 是"按 bot 派生的匿名 id"(20+位字符串),与 TMA initData 的真实
-- telegram_user_id 是两套标识，必须分开存(且为字符串，避免当数字存丢精度)。
SET @c = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_user' AND COLUMN_NAME = 'telegram_oidc_sub'
);
SET @s = IF(@c = 0,
  'ALTER TABLE `bg_user` ADD COLUMN `telegram_oidc_sub` VARCHAR(64) NULL AFTER `telegram_username`',
  'SELECT 1'
);
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @i = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_user' AND INDEX_NAME = 'uk_telegram_oidc_sub'
);
SET @s = IF(@i = 0,
  'ALTER TABLE `bg_user` ADD UNIQUE KEY `uk_telegram_oidc_sub` (`telegram_oidc_sub`)',
  'SELECT 1'
);
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
