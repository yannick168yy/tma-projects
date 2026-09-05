-- P3-6 跨租户风控联防：平台级黑名单 + 跨租户身份撞库识别。
--
-- 🔴 只存 HMAC 摘要，不存明文。平台库里躺着几十家客户的玩家手机号与银行卡号，
-- 一次拖库就是所有客户一起出事；而联防只需要「同一个值是否出现在多家」，摘要就够。
-- 展示用 value_hint（尾号/掩码）够运营核对，也不足以还原原值。
--
-- pepper 来自 RISK_FEDERATION_PEPPER（env）。没配 pepper 时联防整体关闭：
-- 手机号空间只有 10 位数字，不加盐的 sha256 能被穷举反查，等于明文。
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `pf_risk_blacklist` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `id_type`     ENUM('device','phone','bank_card','ip','id_no') NOT NULL,
  `value_hash`  CHAR(64) NOT NULL COMMENT 'HMAC-SHA256(pepper, 归一化后的值)',
  `value_hint`  VARCHAR(32) NULL COMMENT '掩码，如 ****1234，仅供人工核对',
  -- watch    = 只记不拦（观察期）
  -- escalate = 转人工复核（默认，误伤代价最小）
  -- deny     = 直接拒绝，留给已确认的团伙
  `severity`    ENUM('watch','escalate','deny') NOT NULL DEFAULT 'escalate',
  `reason`      VARCHAR(255) NOT NULL,
  `source_tenant_id` INT UNSIGNED NULL COMMENT '哪家客户报上来的；平台自己加的为 NULL',
  `created_by`  INT UNSIGNED NULL COMMENT 'pf_admin.id',
  `expires_at`  DATETIME(3) NULL COMMENT '到期自动失效。NULL=长期',
  `hit_count`   INT UNSIGNED NOT NULL DEFAULT 0,
  `last_hit_at` DATETIME(3) NULL,
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_type_hash` (`id_type`, `value_hash`),
  KEY `idx_hit` (`last_hit_at`),
  CONSTRAINT `fk_pf_blacklist_tenant` FOREIGN KEY (`source_tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='跨租户风控名单（只存摘要）';

-- 身份出现登记：同一个摘要在几家租户出现过。撞库识别就是查 tenant 数 >= 2 的行。
CREATE TABLE IF NOT EXISTS `pf_risk_identity` (
  `id_type`    ENUM('device','phone','bank_card','ip','id_no') NOT NULL,
  `value_hash` CHAR(64) NOT NULL,
  `tenant_id`  INT UNSIGNED NOT NULL,
  `value_hint` VARCHAR(32) NULL,
  `user_count` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT '该租户下用这个值的玩家数',
  `first_seen` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_seen`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id_type`, `value_hash`, `tenant_id`),
  KEY `idx_identity_tenant` (`tenant_id`, `id_type`),
  CONSTRAINT `fk_pf_identity_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='跨租户身份出现登记（只存摘要）';

-- 联防命中：哪家、在哪个管控点、命中了什么。租户自己的命中日志仍在租户库，
-- 这张表是平台视角的汇总，用来看「这条名单到底有没有用」。
CREATE TABLE IF NOT EXISTS `pf_risk_hit` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`  INT UNSIGNED NOT NULL,
  `id_type`    ENUM('device','phone','bank_card','ip','id_no') NOT NULL,
  `value_hash` CHAR(64) NOT NULL,
  `checkpoint` VARCHAR(32) NOT NULL,
  `action`     VARCHAR(16) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_hit_tenant` (`tenant_id`, `created_at`),
  KEY `idx_hit_hash` (`id_type`, `value_hash`),
  CONSTRAINT `fk_pf_hit_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='跨租户联防命中日志';
