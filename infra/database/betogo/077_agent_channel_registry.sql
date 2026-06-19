-- 077: 代理渠道注册表（域名 / TMA 机器人）
--
-- 将 076 的 bg_agent_channel（代理内自由填渠道）升级为两张全局注册表：
--   bg_agent_domain  — 全局域名池，agent_id 可空（空=未分配）
--   bg_agent_bot     — 全局 TMA 机器人池，存 bot_token 用于多 token 验签识别入口 bot
--
-- 一个域名/机器人最多归一个代理；一个代理可多个域名/机器人。
-- 添加代理时从已配置且未分配的域名/机器人中选择并分配。
--
-- bot 入口识别原理：initData 不含 bot 身份，仅 hash 由该 bot token 做 HMAC 得出；
-- 登录时用各 bot token 依次验签，验过的即用户入口 bot → 其 agent_id。

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 076 的 bg_agent_channel 无业务数据，直接替换为下面两张表
DROP TABLE IF EXISTS `bg_agent_channel`;

CREATE TABLE IF NOT EXISTS `bg_agent_domain` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `domain`     VARCHAR(128) NOT NULL                COMMENT '域名（小写、去协议去端口）',
  `label`      VARCHAR(64)  NOT NULL DEFAULT ''     COMMENT '备注名',
  `agent_id`   VARCHAR(32)  NULL                    COMMENT '归属代理，空=未分配',
  `enabled`    TINYINT(1)   NOT NULL DEFAULT 1,
  `created_by` INT          NULL,
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_domain` (`domain`),
  KEY `idx_agent` (`agent_id`),
  CONSTRAINT `fk_adomain_agent` FOREIGN KEY (`agent_id`) REFERENCES `bg_agent` (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='代理域名池，可分配给代理';

CREATE TABLE IF NOT EXISTS `bg_agent_bot` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bot_username` VARCHAR(64)  NOT NULL                COMMENT 'bot 用户名（不含 @）',
  `bot_id`       BIGINT       NULL                    COMMENT 'getMe 返回的 bot id',
  `bot_token`    VARCHAR(128) NOT NULL                COMMENT 'bot token，用于验签识别入口（不对外返回）',
  `label`        VARCHAR(64)  NOT NULL DEFAULT ''     COMMENT '备注名',
  `agent_id`     VARCHAR(32)  NULL                    COMMENT '归属代理，空=未分配',
  `enabled`      TINYINT(1)   NOT NULL DEFAULT 1,
  `created_by`   INT          NULL,
  `created_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bot_username` (`bot_username`),
  KEY `idx_agent` (`agent_id`),
  CONSTRAINT `fk_abot_agent` FOREIGN KEY (`agent_id`) REFERENCES `bg_agent` (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='代理 TMA 机器人池，存 token 供多 token 验签识别入口';

SET FOREIGN_KEY_CHECKS = 1;
