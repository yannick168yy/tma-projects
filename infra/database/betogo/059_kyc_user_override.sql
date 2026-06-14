-- 059: KYC 证件/人脸校验的按用户覆盖（NULL=跟随系统配置，1=强制开启，0=强制关闭）
ALTER TABLE `bg_user`
  ADD COLUMN `kyc_doc_override`  TINYINT(1) NULL COMMENT 'KYC证件校验覆盖：NULL跟随系统/1强制开/0强制关' AFTER `label`,
  ADD COLUMN `kyc_face_override` TINYINT(1) NULL COMMENT 'KYC人脸校验覆盖：NULL跟随系统/1强制开/0强制关' AFTER `kyc_doc_override`;
