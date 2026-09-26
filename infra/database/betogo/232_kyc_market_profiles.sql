-- KYC 验证结果按市场区分，避免先用其他市场证件通过后切 INR 绕过印度证件清单。
ALTER TABLE `bg_kyc`
  ADD COLUMN `market` ENUM('PH','ID','IN') NULL AFTER `status`;

UPDATE `bg_kyc`
SET `market` = CASE
  WHEN `doc_type` IN ('aadhaar','voter_id','nrega_job_card','npr_letter') THEN 'IN'
  WHEN `doc_type` IN ('ktp','sim') THEN 'ID'
  WHEN `doc_type` IS NOT NULL THEN 'PH'
  ELSE NULL
END
WHERE `market` IS NULL;

INSERT IGNORE INTO `bg_admin_settings` (`key`, `value`)
SELECT CONCAT(base.`key`, '_', market.code), COALESCE(current_value.`value`, base.default_value)
FROM (
  SELECT 'kyc_require_phone' AS `key`, '1' AS default_value
  UNION ALL SELECT 'kyc_require_document', '1'
  UNION ALL SELECT 'kyc_require_face', '1'
) base
CROSS JOIN (
  SELECT 'ph' AS code UNION ALL SELECT 'id' UNION ALL SELECT 'in'
) market
LEFT JOIN `bg_admin_settings` current_value ON current_value.`key` = base.`key`;

INSERT IGNORE INTO `bg_admin_settings` (`key`, `value`)
SELECT CONCAT('kyc_face_match_threshold_', market.code), current_value.`value`
FROM (
  SELECT 'ph' AS code UNION ALL SELECT 'id' UNION ALL SELECT 'in'
) market
JOIN `bg_admin_settings` current_value ON current_value.`key` = 'kyc_face_match_threshold';
