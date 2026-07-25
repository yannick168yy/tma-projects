-- 170: 站外 APK 安装归因配对
-- 浏览器落地页与 App WebView 的存储互相隔离，落地页存的 betogo_attr 带不进 App。
-- 桥接方式：点下载时把归因快照落此表，App 首启按 IP+机型 在 24h 窗内认领，
-- 认领后前端写回本地存储，注册照旧走 X-Attr 管线（bg_user_attribution / CAPI 均不感知）。
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `bg_pending_install` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `attr_json`  TEXT         NOT NULL COMMENT '前端 betogo_attr 快照(JSON 原文)',
  `client_ip`  VARCHAR(45)  NOT NULL,
  `device_key` VARCHAR(128) NOT NULL COMMENT 'UA 提取的 android版本|机型，Chrome 与壳 WebView 一致',
  `user_agent` VARCHAR(255)     NULL COMMENT '点击侧 UA 原文，排查配对误差用',
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `matched_at` DATETIME(3)      NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pair` (`client_ip`, `device_key`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='APK 安装归因配对暂存';
