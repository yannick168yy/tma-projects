-- 057: KYC 分步字段（手机 → 证件 → 人脸活体）
ALTER TABLE `bg_kyc`
  ADD COLUMN `doc_verified` TINYINT(1) NOT NULL DEFAULT 0 AFTER `phone_verified`,
  ADD COLUMN `face_verified` TINYINT(1) NOT NULL DEFAULT 0 AFTER `doc_verified`,
  ADD COLUMN `reject_step` ENUM('phone','document','face') NULL AFTER `reject_reason`,
  ADD COLUMN `liveness_frames` JSON NULL COMMENT '活体帧元数据 [{action, key, capturedAt}]' AFTER `selfie_image_key`,
  ADD COLUMN `doc_submitted_at` DATETIME(3) NULL AFTER `submitted_at`,
  ADD COLUMN `face_submitted_at` DATETIME(3) NULL AFTER `doc_submitted_at`;

-- 旧已通过记录补写分步标记
UPDATE `bg_kyc`
SET `doc_verified` = 1, `face_verified` = 1
WHERE `status` = 'approved';
