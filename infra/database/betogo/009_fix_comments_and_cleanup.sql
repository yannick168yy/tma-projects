-- 009: 修复表注释编码 + 补充缺失注释

-- ── 修复/补充表注释 ──────────────────────────────────────────────────────────
ALTER TABLE `admin_accounts`  COMMENT='后台管理员账号';
ALTER TABLE `admin_audit_log` COMMENT='管理员操作审计日志';
ALTER TABLE `bg_admin_settings` COMMENT='系统全局配置项';
ALTER TABLE `bg_login_log`    COMMENT='用户登录历史';
ALTER TABLE `bg_order_deposit`  COMMENT='存款订单（统一）';
ALTER TABLE `bg_order_withdraw` COMMENT='提款订单（统一）';
