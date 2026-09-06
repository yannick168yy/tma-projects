-- P3-7 开放 API：给租户的程序化访问入口。
--
-- 为什么要有这层：客户的「后台再加一个报表」「导出某个字段」这类需求是无底洞，
-- 每个都改后台代码等于把定制化搬进主干。给一把 key 让他自己拉数据，
-- 需求就从「改我们的代码」变成「他写他的脚本」。
--
-- 🔴 只存密钥摘要。API key 是高熵随机串，不像密码需要慢哈希（撞不出来），
-- 但明文存库等于一次拖库就把所有客户的数据接口交出去。
CREATE TABLE IF NOT EXISTS `pf_api_key` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`  INT UNSIGNED NOT NULL,
  `name`       VARCHAR(64)  NOT NULL COMMENT '客户自己写的用途备注',
  -- 前缀明文可见：客户手里有多把 key 时，日志与列表里靠前缀对得上是哪一把
  `key_prefix` CHAR(12)     NOT NULL,
  `key_hash`   CHAR(64)     NOT NULL COMMENT 'sha256(完整 key)',
  `scopes`     VARCHAR(255) NOT NULL COMMENT '逗号分隔，如 users:read,orders:read',
  `rate_per_min` INT UNSIGNED NOT NULL DEFAULT 120 COMMENT '每分钟请求上限',
  `ip_allowlist` VARCHAR(255) NULL COMMENT '逗号分隔，留空=不限（不限时只靠 key 本身）',
  `enabled`    TINYINT(1)   NOT NULL DEFAULT 1,
  `last_used_at` DATETIME(3) NULL,
  `last_used_ip` VARCHAR(64) NULL,
  `expires_at` DATETIME(3)  NULL COMMENT '留空=长期',
  `created_by` VARCHAR(64)  NULL COMMENT '租户后台账号或平台管理员',
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_api_key_prefix` (`key_prefix`),
  KEY `idx_api_key_tenant` (`tenant_id`, `enabled`),
  CONSTRAINT `fk_api_key_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='开放 API 密钥（P3-7）';
