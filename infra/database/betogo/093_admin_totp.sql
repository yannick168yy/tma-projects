ALTER TABLE `admin_accounts`
  ADD COLUMN `totp_secret` VARCHAR(64) NULL COMMENT 'Google Authenticator TOTP secret' AFTER `password_hash`,
  ADD COLUMN `totp_enabled` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否启用 Google Authenticator' AFTER `totp_secret`,
  ADD COLUMN `totp_confirmed_at` DATETIME(3) NULL COMMENT 'TOTP 首次确认时间' AFTER `totp_enabled`;
