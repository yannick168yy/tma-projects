-- 152: 下线账号密码登录——清理 account 身份数据并从枚举中移除
-- DELETE 带精确 WHERE 且经 schema_migrations 保证只执行一次
DELETE FROM `bg_user_identity` WHERE `provider` = 'account';
DELETE FROM `bg_login_log` WHERE `auth_method` = 'account';

ALTER TABLE `bg_user_identity`
  MODIFY COLUMN `provider` ENUM('phone','google','telegram','telegram_oidc') NOT NULL;
