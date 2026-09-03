-- P1-1 平台库商务层：套餐、功能开关、聚合商子代理、支付通道、平台管理员、审计。
--
-- 边界重申：这里只放跨租户的平台层数据。任何单租户业务数据都不许进来。
SET NAMES utf8mb4;

-- ── 套餐 ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pf_plan` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`        VARCHAR(32)  NOT NULL COMMENT '标准版/进阶版/旗舰版的机器码',
  `name`        VARCHAR(64)  NOT NULL,
  `description` VARCHAR(255) NULL,
  `enabled`     TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_plan_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='套餐';

-- 功能开关矩阵。一个 flag 要同时控制前台路由、底部导航、后台菜单、BFF 接口，
-- 四处都要校验 —— 前端隐藏菜单不是安全边界。
CREATE TABLE IF NOT EXISTS `pf_plan_feature` (
  `plan_id`     INT UNSIGNED NOT NULL,
  `feature_key` VARCHAR(64)  NOT NULL COMMENT '如 sports/slots/vip/team/checkin/spin/cs_ai',
  `enabled`     TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (`plan_id`, `feature_key`),
  CONSTRAINT `fk_plan_feature_plan` FOREIGN KEY (`plan_id`) REFERENCES `pf_plan` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='套餐功能开关矩阵';

-- 租户可覆盖的配置白名单（P1-14）：套餐决定租户能改哪些业务参数、改到什么范围。
-- 不给白名单的项，租户后台只读。
CREATE TABLE IF NOT EXISTS `pf_plan_override` (
  `plan_id`     INT UNSIGNED NOT NULL,
  `config_key`  VARCHAR(64)  NOT NULL COMMENT '如 rebate_rate/vip_threshold/withdraw_min',
  `min_value`   DECIMAL(18,6) NULL COMMENT '允许的下限，NULL=不限',
  `max_value`   DECIMAL(18,6) NULL COMMENT '允许的上限，NULL=不限',
  PRIMARY KEY (`plan_id`, `config_key`),
  CONSTRAINT `fk_plan_override_plan` FOREIGN KEY (`plan_id`) REFERENCES `pf_plan` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='套餐允许租户覆盖的配置范围';

CREATE TABLE IF NOT EXISTS `pf_tenant_plan` (
  `tenant_id`  INT UNSIGNED NOT NULL,
  `plan_id`    INT UNSIGNED NOT NULL,
  `started_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `ended_at`   DATETIME(3)  NULL COMMENT 'NULL=当前生效；换套餐时给旧记录填结束时间，保留历史',
  PRIMARY KEY (`tenant_id`, `plan_id`, `started_at`),
  KEY `idx_tenant_current` (`tenant_id`, `ended_at`),
  CONSTRAINT `fk_tenant_plan_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`),
  CONSTRAINT `fk_tenant_plan_plan` FOREIGN KEY (`plan_id`) REFERENCES `pf_plan` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户套餐（含历史）';

-- ── 聚合商子代理 ─────────────────────────────────────────────────────────
-- 每租户一个 win568 子代理，注单天然按租户分离，也是 P2 分成计算的凭据来源。
CREATE TABLE IF NOT EXISTS `pf_tenant_provider` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`     INT UNSIGNED NOT NULL,
  `provider`      VARCHAR(32)  NOT NULL COMMENT '聚合商代号，当前只有 win568',
  `agent_account` VARCHAR(64)  NOT NULL COMMENT '子代理账号',
  `credential_cipher` TEXT     NULL COMMENT '密钥密文。明文一律不落库，后台只显掩码',
  `credential_iv` VARCHAR(64)  NULL,
  `status`        ENUM('pending','active','disabled') NOT NULL DEFAULT 'pending',
  `remark`        VARCHAR(255) NULL,
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_provider` (`tenant_id`, `provider`),
  UNIQUE KEY `uk_provider_agent` (`provider`, `agent_account`),
  CONSTRAINT `fk_tenant_provider_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户的聚合商子代理账号';

-- ── 支付通道 ─────────────────────────────────────────────────────────────
-- owner 区分双资金模式，且同一租户可混用：
--   platform = 平台统一代收代付，资金进平台账户，租户记应付
--   tenant   = 租户自带通道，资金直接进租户账户，平台只按回调流水计费
CREATE TABLE IF NOT EXISTS `pf_tenant_channel` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`    INT UNSIGNED NOT NULL,
  `channel_code` VARCHAR(32)  NOT NULL COMMENT '通道代号，如 unispay/yfpay/matrix',
  `owner`        ENUM('platform','tenant') NOT NULL DEFAULT 'platform',
  `merchant_no`  VARCHAR(64)  NULL COMMENT '商户号，回调反查租户的兜底依据',
  `credential_cipher` TEXT    NULL COMMENT '通道密钥密文，后台只显掩码',
  `credential_iv` VARCHAR(64) NULL,
  `enabled`      TINYINT(1)   NOT NULL DEFAULT 1,
  `sort_order`   INT          NOT NULL DEFAULT 100,
  `created_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_channel` (`tenant_id`, `channel_code`),
  KEY `idx_merchant_no` (`channel_code`, `merchant_no`),
  CONSTRAINT `fk_tenant_channel_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户支付通道（双资金模式）';

-- ── 平台管理员与审计 ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pf_admin` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`      VARCHAR(64)  NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role`          ENUM('platform_super','platform_ops','platform_finance') NOT NULL DEFAULT 'platform_ops',
  `totp_secret`   VARCHAR(128) NULL,
  `enabled`       TINYINT(1)   NOT NULL DEFAULT 1,
  `last_login_at` DATETIME(3)  NULL,
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pf_admin_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='平台管理员（与租户后台管理员完全分离）';

-- impersonate（以租户身份登录）必须全程留痕，这是包网运营的合规底线
CREATE TABLE IF NOT EXISTS `pf_audit_log` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id`   INT UNSIGNED NULL COMMENT '平台管理员；系统自动操作为 NULL',
  `tenant_id`  INT UNSIGNED NULL COMMENT '操作涉及的租户',
  `action`     VARCHAR(64)  NOT NULL COMMENT '如 tenant.create/tenant.suspend/impersonate.start',
  `target`     VARCHAR(128) NULL,
  `detail`     JSON         NULL,
  `ip`         VARCHAR(64)  NULL,
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_audit_tenant_time` (`tenant_id`, `created_at`),
  KEY `idx_audit_admin_time` (`admin_id`, `created_at`),
  KEY `idx_audit_action_time` (`action`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='平台操作审计（只追加）';

-- ── 种子：三档套餐，对应定制化三批交付 ────────────────────────────────────
INSERT INTO `pf_plan` (`code`, `name`, `description`) VALUES
  ('standard', '标准版', '品牌包 + 文案覆盖 + 首页装修 + 功能开关'),
  ('advanced', '进阶版', '标准版 + 首页区块拖拽 + 活动模板市场'),
  ('flagship', '旗舰版', '进阶版 + UI 定制 overlay + 开放 API')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`), `description` = VALUES(`description`);

-- 自营站挂旗舰版：它本来就拥有全部功能
INSERT INTO `pf_tenant_plan` (`tenant_id`, `plan_id`)
SELECT t.id, p.id FROM `pf_tenant` t JOIN `pf_plan` p ON p.code = 'flagship'
WHERE t.self_operated = 1
  AND NOT EXISTS (SELECT 1 FROM `pf_tenant_plan` tp WHERE tp.tenant_id = t.id AND tp.ended_at IS NULL);

-- 租户级功能开关覆盖：套餐给默认值，平台可对单个租户单独开关。
-- 真实运营一定会出现「这家先别开提现」这类需求，只有套餐粒度不够用。
CREATE TABLE IF NOT EXISTS `pf_tenant_feature` (
  `tenant_id`   INT UNSIGNED NOT NULL,
  `feature_key` VARCHAR(64)  NOT NULL,
  `enabled`     TINYINT(1)   NOT NULL,
  `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenant_id`, `feature_key`),
  CONSTRAINT `fk_tenant_feature_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户级功能开关覆盖（优先于套餐默认值）';

-- 功能清单种子：三档套餐先全开。租户少的时候不该靠套餐限制功能，
-- 需要限制时用 pf_tenant_feature 对单个租户关，或后续调整套餐矩阵。
-- 用 INSERT IGNORE 而非 ON DUPLICATE：INSERT...SELECT 里带 UNION 时
-- MySQL 不接受 ON DUPLICATE KEY UPDATE 子句
INSERT IGNORE INTO `pf_plan_feature` (`plan_id`, `feature_key`, `enabled`)
SELECT p.id, f.k, 1 FROM `pf_plan` p CROSS JOIN (
  SELECT 'slots' AS k UNION ALL SELECT 'live' UNION ALL SELECT 'sports' UNION ALL
  SELECT 'lottery' UNION ALL SELECT 'fishing' UNION ALL
  SELECT 'task' UNION ALL SELECT 'checkin' UNION ALL SELECT 'spin' UNION ALL
  SELECT 'vip' UNION ALL SELECT 'rebate' UNION ALL SELECT 'loss_rebate' UNION ALL
  SELECT 'team_commission' UNION ALL SELECT 'agent_center' UNION ALL
  SELECT 'community' UNION ALL SELECT 'tg_broadcast' UNION ALL SELECT 'cs_ai' UNION ALL
  SELECT 'kyc' UNION ALL SELECT 'login_telegram' UNION ALL SELECT 'login_google' UNION ALL
  SELECT 'app_download'
) f;
