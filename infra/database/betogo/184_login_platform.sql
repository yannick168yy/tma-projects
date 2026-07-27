-- 184: 记录用户登录时的客户端平台（网页 / App / PWA / Telegram）
--
-- 前端 client.ts 注入 X-Platform 头（值由 web-tma/src/utils/pwa.ts 的 clientPlatform() 判定）：
--   web=普通浏览器  app=Android 原生壳(APK)  pwa=已装桌面启动  telegram=Telegram Mini App
-- 之前只能靠 auth_method/entry_source 间接推断 App/Telegram，PWA 与普通网页无法区分，这里补齐。

SET NAMES utf8mb4;

SET @has_login_platform = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_login_log' AND COLUMN_NAME = 'platform');
SET @sql_login_platform = IF(@has_login_platform = 0,
  "ALTER TABLE `bg_login_log` ADD COLUMN `platform` VARCHAR(16) NULL COMMENT '客户端平台 web/app/pwa/telegram' AFTER `entry_source`",
  'SELECT 1');
PREPARE st_login_platform FROM @sql_login_platform; EXECUTE st_login_platform; DEALLOCATE PREPARE st_login_platform;

SET @has_user_platform = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_user' AND COLUMN_NAME = 'last_platform');
SET @sql_user_platform = IF(@has_user_platform = 0,
  "ALTER TABLE `bg_user` ADD COLUMN `last_platform` VARCHAR(16) NULL COMMENT '最近登录客户端平台 web/app/pwa/telegram' AFTER `last_login_region`",
  'SELECT 1');
PREPARE st_user_platform FROM @sql_user_platform; EXECUTE st_user_platform; DEALLOCATE PREPARE st_user_platform;
