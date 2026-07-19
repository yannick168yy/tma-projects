-- 060: KYC 证件提交历史记录表
-- 每次用户提交证件时插入一条，admin 后台可查看所有历史提交记录
CREATE TABLE IF NOT EXISTS `bg_kyc_doc_log` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`          VARCHAR(32)  NOT NULL,
  `full_name`        VARCHAR(128) NULL,
  `doc_type`         VARCHAR(32)  NULL,
  `doc_image_key`    VARCHAR(255) NULL,
  `gemini_confidence` DECIMAL(4,3) NULL,
  `doc_verified`     TINYINT(1)   NOT NULL DEFAULT 0,
  `reject_reason`    VARCHAR(255) NULL,
  `submitted_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_user_submitted` (`user_id`, `submitted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='KYC 证件提交历史';
