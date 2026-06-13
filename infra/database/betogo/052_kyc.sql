-- 052: KYC 实名认证表（取款前 = 手机短信验证 + 证件/人脸 Gemini 校验）
CREATE TABLE IF NOT EXISTS `bg_kyc` (
  `user_id`          VARCHAR(32) NOT NULL,
  `status`           ENUM('none','pending','approved','rejected') NOT NULL DEFAULT 'none',
  `phone`            VARCHAR(32)  NULL COMMENT 'KYC 已验证手机(E.164)，与 phone_account 分离',
  `phone_verified`   TINYINT(1)   NOT NULL DEFAULT 0,
  `full_name`        VARCHAR(128) NULL,
  `doc_type`         VARCHAR(32)  NULL COMMENT 'passport|drivers_license|philid|umid',
  `verify_mode`      ENUM('document','face') NULL,
  `extracted_id_no`  VARCHAR(64)  NULL COMMENT 'Gemini 从证件提取的证件号，用于防重',
  `gemini_confidence` DECIMAL(4,3) NULL,
  `gemini_result`    JSON         NULL,
  `doc_image_key`    VARCHAR(255) NULL,
  `selfie_image_key` VARCHAR(255) NULL,
  `reject_reason`    VARCHAR(255) NULL,
  `submitted_at`     DATETIME(3)  NULL,
  `reviewed_at`      DATETIME(3)  NULL,
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  KEY `idx_phone_verified` (`phone`, `phone_verified`),
  KEY `idx_extracted_id_no` (`extracted_id_no`),
  CONSTRAINT `fk_kyc_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='KYC 实名认证';
