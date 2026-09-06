-- P3-5 租户自助：出包申请队列 + 自助操作留痕。
--
-- 出包本身在出包机上跑（签名密钥只在人手里，服务器上也没有 Android SDK），
-- 所以「自助出包」的现实形态是：客户自己把参数调好 → 提一条申请 → 平台在出包机上跑一次。
-- 不做「后台点一下就出包」的按钮：那需要把签名密钥放到服务器上，密钥泄露等于
-- 别人可以给客户已发布的 App 推更新。
CREATE TABLE IF NOT EXISTS `pf_app_build_request` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`  INT UNSIGNED NOT NULL,
  `app_market` VARCHAR(8)   NOT NULL,
  `version_name` VARCHAR(16) NOT NULL,
  `version_code` INT UNSIGNED NOT NULL,
  `note`       VARCHAR(255) NULL COMMENT '客户填的说明：这次出包要解决什么',
  `status`     ENUM('pending','building','done','rejected') NOT NULL DEFAULT 'pending',
  `requested_by` VARCHAR(64) NULL COMMENT '租户后台账号',
  `handled_by` INT UNSIGNED NULL COMMENT 'pf_admin.id',
  `handled_at` DATETIME(3)  NULL,
  `artifact_url` VARCHAR(255) NULL COMMENT '出好的包放哪（平台填）',
  `reject_reason` VARCHAR(255) NULL,
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_build_status` (`status`, `created_at`),
  -- 同一租户同一市场只允许一条在排队：客户连点五次不该变成五个待办
  UNIQUE KEY `uk_pending_one` (`tenant_id`, `app_market`, `status`),
  CONSTRAINT `fk_build_req_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='App 出包申请（P3-5）';

-- 自助操作留痕：客户自己改的东西也要能查。租户库里有自己的审计表，
-- 但涉及平台库的改动（通道凭据、出包参数）落在平台侧才查得全。
CREATE TABLE IF NOT EXISTS `pf_self_service_log` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`  INT UNSIGNED NOT NULL,
  `action`     VARCHAR(48) NOT NULL COMMENT 'channel.credential / app.params / app.build_request',
  `detail`     JSON NULL COMMENT '🔴 不记凭据明文，只记改了哪个通道',
  `operator`   VARCHAR(64) NULL COMMENT '租户后台账号',
  `ip`         VARCHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_self_log_tenant` (`tenant_id`, `created_at`),
  CONSTRAINT `fk_self_log_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户自助操作日志（P3-5）';
