-- 平台库初始化：租户注册表、域名映射、市场配置
--
-- 平台库（betogo_platform）与租户库（betogo / betogo_tNNN）是两套独立的迁移体系，
-- 各自维护自己的 schema_migrations，互不干扰。
-- 平台库只放"跨租户"的东西，任何单租户业务数据都不许进来。
SET NAMES utf8mb4;

-- 租户（运营商）。自营站也是一个租户，且保留原库名 betogo，不改名不迁数据。
CREATE TABLE IF NOT EXISTS `pf_tenant` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`        VARCHAR(32)  NOT NULL COMMENT '租户代号，用于回调 URL、Redis 前缀、日志字段',
  `name`        VARCHAR(64)  NOT NULL COMMENT '运营商名称',
  `db_name`     VARCHAR(64)  NOT NULL COMMENT '该租户的业务库名',
  `status`      ENUM('trial','active','withdraw_suspended','deposit_suspended','suspended','closed')
                NOT NULL DEFAULT 'trial'
                COMMENT '试用/正常/停提现/停充值/停站/关站（欠费按此顺序降级）',
  `self_operated` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '自营站标记，计费与停站策略对其豁免',
  `remark`      VARCHAR(255) NULL,
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_code` (`code`),
  UNIQUE KEY `uk_tenant_db` (`db_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户（运营商）';

-- 域名 → 租户。全局唯一：一个域名只能属于一个租户，这是请求路由的唯一依据。
-- market / app_market / app_priority 与租户库 bg_admin_settings.site_domain_mappings 同构，
-- P0 阶段先做快照，域名归属由平台库定，市场判定仍走原 site-domain.service（避免一次改两处）。
CREATE TABLE IF NOT EXISTS `pf_tenant_domain` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`    INT UNSIGNED NOT NULL,
  `domain`       VARCHAR(128) NOT NULL COMMENT '归一化后：小写、无协议、无端口、无 www 前缀',
  `market`       VARCHAR(8)   NOT NULL DEFAULT 'PH' COMMENT 'PH | ID | PUBLIC',
  `purpose`      ENUM('site','admin','app_route','landing') NOT NULL DEFAULT 'site',
  `enabled`      TINYINT(1)   NOT NULL DEFAULT 1,
  `app_market`   VARCHAR(2)   NULL COMMENT 'App 线路组归属，NULL=不参与 App 线路下发',
  `app_priority` SMALLINT UNSIGNED NOT NULL DEFAULT 100 COMMENT 'App 线路优先级，小的先用',
  `created_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_domain` (`domain`),
  KEY `idx_tenant_purpose` (`tenant_id`, `purpose`, `enabled`),
  CONSTRAINT `fk_tenant_domain_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='域名 → 租户映射';

-- 租户开通的市场。market 与租户正交：一个租户可同时运营 PH + ID。
-- 时区决定该市场的业务日切点（沿用 207_team_market_timezone 的口径）。
CREATE TABLE IF NOT EXISTS `pf_tenant_market` (
  `tenant_id`  INT UNSIGNED NOT NULL,
  `market`     VARCHAR(2)   NOT NULL,
  `currency`   VARCHAR(8)   NOT NULL,
  `timezone`   VARCHAR(32)  NOT NULL COMMENT 'IANA 时区名，如 Asia/Manila',
  `enabled`    TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenant_id`, `market`),
  CONSTRAINT `fk_tenant_market_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户开通的市场与币种';

-- ── 自营站登记为 tenant #1 ────────────────────────────────────────────────
INSERT INTO `pf_tenant` (`id`, `code`, `name`, `db_name`, `status`, `self_operated`, `remark`)
VALUES (1, 'betogo', 'BetoGo 自营站', 'betogo', 'active', 1, '保留原库名，不改名不迁数据')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

INSERT INTO `pf_tenant_market` (`tenant_id`, `market`, `currency`, `timezone`) VALUES
  (1, 'PH', 'PHP', 'Asia/Manila'),
  (1, 'ID', 'IDR', 'Asia/Jakarta')
ON DUPLICATE KEY UPDATE `currency` = VALUES(`currency`), `timezone` = VALUES(`timezone`);

-- 域名快照取自 212_app_domain_groups 的最终态，另补测试环境与后台域名。
INSERT INTO `pf_tenant_domain` (`tenant_id`, `domain`, `market`, `purpose`, `app_market`, `app_priority`) VALUES
  (1, 'betogo.games',  'PH', 'site',  'PH', 10),
  (1, 'betogo666.com', 'PH', 'site',  'PH', 20),
  (1, 'betogo777.com', 'PH', 'site',  'PH', 30),
  (1, 'betogo.ph',     'PH', 'site',  NULL, 100),
  (1, 'betogo.app',    'ID', 'site',  'ID', 10),
  (1, 'betogo.xyz',    'ID', 'site',  'ID', 20),
  (1, 'betogo.vip',    'ID', 'site',  'ID', 30),
  (1, 'betogo888.com', 'ID', 'site',  NULL, 100),
  (1, 'betogo.cc',     'ID', 'site',  NULL, 100),
  (1, '188facai.com',  'PH', 'site',  NULL, 100),
  (1, 'admin.betogo.games', 'PH', 'admin', NULL, 100)
ON DUPLICATE KEY UPDATE `market` = VALUES(`market`), `purpose` = VALUES(`purpose`);
