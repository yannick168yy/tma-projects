-- 240: KYC 手机验证的按用户覆盖（NULL=跟随系统配置，1=强制开启，0=强制关闭）
ALTER TABLE `bg_user`
  ADD COLUMN `kyc_phone_override` TINYINT(1) NULL COMMENT 'KYC手机验证覆盖：NULL跟随系统/1强制开/0强制关' AFTER `kyc_face_override`;
