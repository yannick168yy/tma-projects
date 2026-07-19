-- ── 管理后台账号 ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS `admin_accounts` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`        VARCHAR(64)  NOT NULL,
  `password_hash`   VARCHAR(255) NOT NULL COMMENT 'scrypt:{salt}:{hash}',
  `role`            ENUM('super_admin','finance','ops','support') NOT NULL DEFAULT 'support',
  `status`          ENUM('active','disabled') NOT NULL DEFAULT 'active',
  `last_login_at`   DATETIME(3) NULL,
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='后台管理员账号';

-- ── 操作审计日志 ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS `admin_audit_log` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id`        INT UNSIGNED    NOT NULL,
  `admin_username`  VARCHAR(64)     NOT NULL,
  `action`          VARCHAR(128)    NOT NULL,
  `target_type`     VARCHAR(64)     NULL,
  `target_id`       VARCHAR(128)    NULL,
  `detail`          JSON            NULL,
  `ip`              VARCHAR(64)     NULL,
  `created_at`      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_admin_created` (`admin_id`, `created_at` DESC),
  KEY `idx_target`        (`target_type`, `target_id`),
  KEY `idx_created`       (`created_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员操作审计';
