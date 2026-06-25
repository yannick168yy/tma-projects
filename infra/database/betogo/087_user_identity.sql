-- 087: 统一登录身份表；bg_user 只保留账户主体资料
CREATE TABLE `bg_user_identity` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`         VARCHAR(32)     NOT NULL,
  `provider`        ENUM('phone','account','google','telegram','telegram_oidc') NOT NULL,
  `identifier`      VARCHAR(191)    NOT NULL,
  `credential_hash` VARCHAR(255)    NULL,
  `display_label`   VARCHAR(255)    NULL,
  `verified_at`     DATETIME(3)     NULL,
  `created_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_provider_identifier` (`provider`, `identifier`),
  KEY `idx_user_provider` (`user_id`, `provider`),
  CONSTRAINT `fk_user_identity_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户登录身份';

ALTER TABLE `bg_user`
  DROP INDEX `uk_telegram_user_id`,
  DROP INDEX `uk_google_sub`,
  DROP INDEX `uk_telegram_oidc_sub`,
  DROP INDEX `uk_username`,
  DROP INDEX `uk_phone_account`;

ALTER TABLE `bg_user`
  DROP COLUMN `telegram_user_id`,
  DROP COLUMN `telegram_username`,
  DROP COLUMN `telegram_oidc_sub`,
  DROP COLUMN `google_sub`,
  DROP COLUMN `username`,
  DROP COLUMN `password_hash`,
  DROP COLUMN `phone_account`;
