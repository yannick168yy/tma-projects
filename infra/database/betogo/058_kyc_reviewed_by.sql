-- 058: KYC 人工复核记录审核人
ALTER TABLE `bg_kyc`
  ADD COLUMN `reviewed_by` VARCHAR(64) NULL COMMENT '人工复核管理员用户名(自动放行时为空)' AFTER `reviewed_at`;
