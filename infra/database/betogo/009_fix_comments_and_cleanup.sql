-- 009: 修复表注释编码 + 补充缺失注释 + 清空测试财务数据

-- ── 修复/补充表注释 ──────────────────────────────────────────────────────────
ALTER TABLE `admin_accounts`  COMMENT='后台管理员账号';
ALTER TABLE `admin_audit_log` COMMENT='管理员操作审计日志';
ALTER TABLE `bg_admin_settings` COMMENT='系统全局配置项';
ALTER TABLE `bg_login_log`    COMMENT='用户登录历史';
ALTER TABLE `bg_order_deposit`  COMMENT='存款订单（统一）';
ALTER TABLE `bg_order_withdraw` COMMENT='提款订单（统一）';

-- ── 清空测试财务数据 ──────────────────────────────────────────────────────────
SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE `bg_wallet_ledger`;
TRUNCATE TABLE `bg_order_deposit`;
TRUNCATE TABLE `bg_order_withdraw`;
TRUNCATE TABLE `bg_bet_order`;

-- 钱包余额归零（不删行，保留用户钱包记录）
UPDATE `bg_wallet` SET available_cents = 0, frozen_cents = 0;

SET FOREIGN_KEY_CHECKS = 1;
