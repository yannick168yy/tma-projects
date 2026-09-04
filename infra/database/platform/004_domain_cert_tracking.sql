-- P1-4 域名管理 + 证书状态跟踪。
--
-- 域名接入分两种（2026-09-03 用户确认，两种都要支持）：
--   platform_subdomain  <code>.betogo.games，DNS 走平台已控制的泛解析，
--                        证书走平台泛域名证书 *.betogo.games 覆盖 —— 开站时零人工介入
--   custom               客户自带独立域名，DNS 由客户自行配置 A 记录指向服务器，
--                        平台探测解析生效后才能签发单域名证书（HTTP-01，需要域名已解析）
--
-- 证书状态机：none → pending_dns（已登记，等客户配置 DNS）→ issued（已签发，含子域名继承的泛域名证书）
--             issued → expiring（30 天内到期）→ issued（续期后）
--             pending_dns / issued → failed（探测或签发出错，detail 记原因）
SET NAMES utf8mb4;

ALTER TABLE `pf_tenant_domain`
  ADD COLUMN `domain_type` ENUM('platform_subdomain','custom') NOT NULL DEFAULT 'custom'
    COMMENT '子域名走泛域名证书零介入；自带域名需 DNS 验证后单独签发' AFTER `purpose`,
  ADD COLUMN `cert_status` ENUM('none','pending_dns','issued','expiring','failed') NOT NULL DEFAULT 'none'
    COMMENT '证书状态，见文件头状态机说明' AFTER `domain_type`,
  ADD COLUMN `cert_expires_at` DATETIME(3) NULL COMMENT '证书到期时间，来自实测或 certbot 签发结果' AFTER `cert_status`,
  ADD COLUMN `cert_checked_at` DATETIME(3) NULL COMMENT '最近一次证书/DNS 探测时间' AFTER `cert_expires_at`,
  ADD COLUMN `cert_detail` VARCHAR(255) NULL COMMENT '探测或签发失败时的原因，供人工排查' AFTER `cert_checked_at`,
  ADD COLUMN `dns_resolved_ip` VARCHAR(64) NULL COMMENT '最近一次探测到的 A 记录值' AFTER `cert_detail`;

-- 历史域名（自营站现有 11 条）都是各自独立解析、已有证书在跑，
-- 标记为 custom + issued，不需要平台重新探测触发任何动作。
UPDATE `pf_tenant_domain`
   SET `domain_type` = 'custom', `cert_status` = 'issued'
 WHERE `cert_status` = 'none';
