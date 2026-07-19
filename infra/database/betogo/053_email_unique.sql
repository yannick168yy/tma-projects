-- 053: 邮箱跨账号唯一（NULL 不受唯一约束，多个无邮箱账号不冲突）
SET @i = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_user' AND INDEX_NAME = 'uk_email'
);
SET @s = IF(@i = 0,
  'ALTER TABLE `bg_user` ADD UNIQUE KEY `uk_email` (`email`)',
  'SELECT 1'
);
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
