-- 051: 账号体系新增「手机号+密码」「账号+密码」两种登录方式
-- bg_user 增加 username / password_hash / phone_account 三列，各加唯一索引（幂等）

-- username（账号登录）
SET @c1 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_user' AND COLUMN_NAME = 'username'
);
SET @s1 = IF(@c1 = 0,
  'ALTER TABLE `bg_user` ADD COLUMN `username` VARCHAR(32) NULL COMMENT ''账号登录用户名'' AFTER `google_sub`',
  'SELECT 1'
);
PREPARE st FROM @s1; EXECUTE st; DEALLOCATE PREPARE st;

-- password_hash（账号/手机模式共用，scrypt）
SET @c2 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_user' AND COLUMN_NAME = 'password_hash'
);
SET @s2 = IF(@c2 = 0,
  'ALTER TABLE `bg_user` ADD COLUMN `password_hash` VARCHAR(255) NULL COMMENT ''scrypt 密码哈希'' AFTER `username`',
  'SELECT 1'
);
PREPARE st FROM @s2; EXECUTE st; DEALLOCATE PREPARE st;

-- phone_account（手机号登录凭证，E.164，未验证，与 KYC 已验手机分离）
SET @c3 = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_user' AND COLUMN_NAME = 'phone_account'
);
SET @s3 = IF(@c3 = 0,
  'ALTER TABLE `bg_user` ADD COLUMN `phone_account` VARCHAR(32) NULL COMMENT ''手机号登录凭证(E.164)'' AFTER `password_hash`',
  'SELECT 1'
);
PREPARE st FROM @s3; EXECUTE st; DEALLOCATE PREPARE st;

-- 唯一索引：username
SET @i1 = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_user' AND INDEX_NAME = 'uk_username'
);
SET @si1 = IF(@i1 = 0,
  'ALTER TABLE `bg_user` ADD UNIQUE KEY `uk_username` (`username`)',
  'SELECT 1'
);
PREPARE st FROM @si1; EXECUTE st; DEALLOCATE PREPARE st;

-- 唯一索引：phone_account
SET @i2 = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_user' AND INDEX_NAME = 'uk_phone_account'
);
SET @si2 = IF(@i2 = 0,
  'ALTER TABLE `bg_user` ADD UNIQUE KEY `uk_phone_account` (`phone_account`)',
  'SELECT 1'
);
PREPARE st FROM @si2; EXECUTE st; DEALLOCATE PREPARE st;
