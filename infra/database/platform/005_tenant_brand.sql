-- P1-10 品牌包：站名 / logo / 图标 / 主题变量，按租户配置，由 /site/config 下发
--
-- 放平台库而不是租户库：品牌是平台交付给客户的东西，在平台控制台配、开站时就要能配好；
-- 放租户库的话开站流程还得先建库再回头写品牌，且租户后台能改自己的品牌名不合适。

CREATE TABLE IF NOT EXISTS `pf_tenant_brand` (
  `tenant_id`         INT UNSIGNED NOT NULL,
  `site_name`         VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '站名，用于标题栏、文案插值、版权行',
  `short_name`        VARCHAR(32)  NOT NULL DEFAULT '' COMMENT '短名，用于角标与安装引导',
  -- 文字 logo：没上传图片 logo 时用它渲染。拆两段是因为现有 logo 就是「前段常规色 + 后段主色」
  `logo_text_primary` VARCHAR(16)  NOT NULL DEFAULT '' COMMENT '文字 logo 前段（常规色）',
  `logo_text_accent`  VARCHAR(16)  NOT NULL DEFAULT '' COMMENT '文字 logo 后段（主色）',
  `tagline`           VARCHAR(64)  NOT NULL DEFAULT '' COMMENT 'logo 下方标语',
  -- 图片资产存 storage key 而非完整 URL：URL 随 CDN 配置变，key 不变
  `logo_light_key`    VARCHAR(255) NULL COMMENT '亮色底 logo（深色图形）',
  `logo_dark_key`     VARCHAR(255) NULL COMMENT '暗色底 logo（浅色图形）',
  `favicon_key`       VARCHAR(255) NULL,
  `app_icon_key`      VARCHAR(255) NULL COMMENT 'App 图标 / 添加到主屏图标',
  -- 白名单键值对，不是任意 CSS：见 brand.service.ts 的 THEME_KEYS
  `theme`             JSON         NULL COMMENT '主题变量覆盖，键限定在白名单内',
  `updated_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenant_id`),
  CONSTRAINT `fk_tenant_brand_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户品牌包';

-- 自营站登记现有品牌，保证它的表现零变化：
-- 没有这行的话自营站会回落到代码里的默认值，虽然值一样，但「配置为空」和「配置成当前值」
-- 在后台看起来完全不同，运营会以为品牌没配。
INSERT IGNORE INTO `pf_tenant_brand`
  (`tenant_id`, `site_name`, `short_name`, `logo_text_primary`, `logo_text_accent`, `tagline`)
SELECT `id`, 'BETOGO', 'B', 'BETO', 'GO', 'Bet. Go. Win'
  FROM `pf_tenant` WHERE `self_operated` = 1;
