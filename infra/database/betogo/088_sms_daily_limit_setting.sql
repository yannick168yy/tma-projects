-- 088: 验证码每日发送上限系统参数
INSERT IGNORE INTO `bg_admin_settings` (`key`, `value`)
VALUES ('sms_daily_limit_per_user', '30');
