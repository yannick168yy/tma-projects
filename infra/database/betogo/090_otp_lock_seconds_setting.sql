-- 090: 验证码错误锁定时长系统参数
INSERT IGNORE INTO `bg_admin_settings` (`key`, `value`)
VALUES ('otp_lock_seconds', '60');
