-- 130: 用户注册/登录入口来源
--
-- 记录用户注册时来自哪个域名，Telegram Mini App 注册统一记录为 tma；
-- 每次登录也在登录日志中记录当次入口域名或 tma。

SET NAMES utf8mb4;

SET @has_user_entry = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_user' AND COLUMN_NAME = 'register_entry_source');
SET @sql_user_entry = IF(@has_user_entry = 0,
  "ALTER TABLE `bg_user` ADD COLUMN `register_entry_source` VARCHAR(255) NULL COMMENT '注册入口域名或 tma' AFTER `register_region`",
  'SELECT 1');
PREPARE st_user_entry FROM @sql_user_entry; EXECUTE st_user_entry; DEALLOCATE PREPARE st_user_entry;

SET @has_login_entry = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_login_log' AND COLUMN_NAME = 'entry_source');
SET @sql_login_entry = IF(@has_login_entry = 0,
  "ALTER TABLE `bg_login_log` ADD COLUMN `entry_source` VARCHAR(255) NULL COMMENT '登录入口域名或 tma' AFTER `auth_method`",
  'SELECT 1');
PREPARE st_login_entry FROM @sql_login_entry; EXECUTE st_login_entry; DEALLOCATE PREPARE st_login_entry;

CREATE INDEX idx_user_register_entry_source ON bg_user (register_entry_source);
CREATE INDEX idx_login_log_entry_source ON bg_login_log (entry_source);
