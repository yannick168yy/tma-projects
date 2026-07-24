-- 169: 广告投放归因链路（FB / TikTok 买量按首存结算的数据基础）
--   bg_user_attribution —— 注册时一次性快照落地来源，first-touch 不覆盖，channel_code 是结算键
--   bg_capi_event       —— 服务端转化回传的去重与对账日志，唯一键即幂等闸
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `bg_user_attribution` (
  `user_id`        VARCHAR(32)  NOT NULL,
  `channel_code`   VARCHAR(64)      NULL COMMENT '结算渠道标识(投手/像素)，取自 ?c= 或 utm_source',
  `utm_source`     VARCHAR(128)     NULL,
  `utm_medium`     VARCHAR(128)     NULL,
  `utm_campaign`   VARCHAR(191)     NULL,
  `utm_content`    VARCHAR(191)     NULL,
  `utm_term`       VARCHAR(191)     NULL,
  `click_platform` ENUM('facebook','tiktok','google','other') NOT NULL DEFAULT 'other',
  `click_id`       VARCHAR(255)     NULL COMMENT 'fbclid / ttclid 原值',
  `fbp`            VARCHAR(128)     NULL COMMENT '_fbp cookie，FB CAPI 匹配用',
  `fbc`            VARCHAR(255)     NULL COMMENT '_fbc cookie，FB CAPI 匹配用',
  `ttp`            VARCHAR(128)     NULL COMMENT '_ttp cookie，TikTok CAPI 匹配用',
  -- 该条线用的像素 ID，由投放链接 ?px=/?tpx= 带入。服务端 CAPI 靠它决定回传给哪条线，
  -- 所以必须随注册快照存下来（用户可能几天后才充值，那时 URL 参数早没了）
  `fb_pixel_id`    VARCHAR(32)      NULL,
  `tt_pixel_id`    VARCHAR(32)      NULL,
  `landing_host`   VARCHAR(191)     NULL,
  `landing_path`   VARCHAR(255)     NULL,
  `referrer`       VARCHAR(255)     NULL,
  -- CAPI 要求回传注册当时的 UA/IP 做匹配，登录日志里的会随后续登录变化，故在此快照
  `user_agent`     VARCHAR(255)     NULL,
  `client_ip`      VARCHAR(45)      NULL,
  `created_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  KEY `idx_channel_created` (`channel_code`, `created_at`),
  KEY `idx_campaign` (`utm_campaign`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='买量归因：注册来源快照';

CREATE TABLE IF NOT EXISTS `bg_capi_event` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `platform`   ENUM('facebook','tiktok') NOT NULL,
  `event_name` VARCHAR(32)  NOT NULL,
  `event_id`   VARCHAR(64)  NOT NULL COMMENT '去重键：注册=userId，充值=orderId；与前端像素 eventID 同值',
  `user_id`    VARCHAR(32)      NULL,
  `status`     ENUM('sending','sent','failed') NOT NULL DEFAULT 'sending',
  `http_code`  SMALLINT         NULL,
  `error`      VARCHAR(255)     NULL,
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_event` (`platform`, `event_name`, `event_id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='转化回传(CAPI)发送日志，唯一键做幂等';
