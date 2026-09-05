-- P1-15 App 出包参数化：每租户一行出包参数，驱动 android-shell 的 tenant flavor。
--
-- 为什么不给每个租户在 build.gradle 里加一个 flavor：接一个客户改一次构建脚本，
-- 既要提交代码又要发版，50 个租户就是 50 个 flavor block。改为参数全部从这张表读、
-- 由 scripts/build-tenant-apk.sh 以 -P 传进 gradle。
--
-- 🔴 铁律：签名密钥文件与密码永不入库。这里只存一个引用名 keystore_ref，
-- 出包机上对应 apps/android-shell/android/keystore-<ref>.properties（已 gitignore）。
-- 密钥丢了就再也无法更新已发布的 App，它必须留在人手里，不能躺在任何一个能被拖库的地方。

CREATE TABLE IF NOT EXISTS `pf_tenant_app` (
  `tenant_id`           INT UNSIGNED NOT NULL,
  `package_name`        VARCHAR(128) NOT NULL COMMENT 'applicationId，发布后不可更改',
  `app_label`           VARCHAR(32)  NOT NULL COMMENT '桌面显示名',
  `app_market`          VARCHAR(8)   NOT NULL COMMENT '写进 BuildConfig，App 用它请求 /app/bootstrap',
  -- 线路组：App 内置的兜底域名表。平台库 pf_tenant_domain 是权威来源，这里存的是
  -- 「打进这个包里的那一份快照」——改了要重新出包才生效，所以必须单独存一列
  `route_domains`       VARCHAR(512) NOT NULL DEFAULT '' COMMENT '逗号分隔，按内置优先级从高到低',
  `tg_recovery_channel` VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '线路全被封时的旁路发现频道，留空=不启用',
  `splash_background`   VARCHAR(16)  NOT NULL DEFAULT '#080b14' COMMENT '原生启动屏底色，品牌启动图仍在 web 层',
  `keystore_ref`        VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '出包机上的密钥文件引用名，不是路径也不是密码',
  `version_code`        INT UNSIGNED NOT NULL DEFAULT 1,
  `version_name`        VARCHAR(16)  NOT NULL DEFAULT '1.0.0',
  `updated_at`          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  -- 主键带 market：自营站就是一租户两个包（PH/ID），客户站通常只有一行
  PRIMARY KEY (`tenant_id`, `app_market`),
  UNIQUE KEY `uk_tenant_app_package` (`package_name`),
  CONSTRAINT `fk_tenant_app_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户 App 出包参数';

-- 自营站登记现有的两个包，作为参数的样板行，同时占住这两个包名不被误分配给客户。
-- 自营站实际仍走 ph/id 两个既有 flavor 出包（已发布，不动），这里是登记不是切换。
INSERT IGNORE INTO `pf_tenant_app`
  (`tenant_id`, `package_name`, `app_label`, `app_market`, `route_domains`, `version_code`, `version_name`)
VALUES
  (1, 'games.betogo.app', 'BETOGO', 'PH', 'betogo.games,betogo666.com,betogo777.com', 11, '1.0.10'),
  (1, 'games.betogo.id',  'BETOGO', 'ID', 'betogo.app,betogo.xyz,betogo.vip', 11, '1.0.10');
