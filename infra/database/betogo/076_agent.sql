-- 076: 代理人分成体系（独立于三级分销 bg_team_*）
--
-- 面向外部市场/网站推广代理：按其名下用户产生的 GGR 百分比分成。
-- 归因方式：指定 URL 域名 / 指定 TMA 机器人（首版仅域名+手动，bot 预留）。
-- 结算：按月聚合 GGR（扣除赠金/红利），负 GGR 结转下期；仅报表，线下打款。
--
-- 新增 5 张表：
--   bg_agent              — 代理主体（= 被后台指定为代理的 bg_user）
--   bg_agent_channel      — 代理的导流渠道（域名 / bot），一个渠道只归一个代理
--   bg_user_agent         — 用户→代理 归因结果（注册时写入或后台手动指定）
--   bg_agent_ggr_monthly  — 代理月度 GGR 快照（结算时聚合 bg_bet_order/bg_wallet_ledger）
--   bg_agent_commission   — 代理月度分成（含负 GGR 结转）
--
-- 金额单位：PHP 分（BIGINT），与全库一致。命名规范：bg_agent_* 前缀，snake_case。

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. bg_agent  代理主体
--    agent_id 即某个 bg_user.id；后台手动将用户标记为代理。
--    ggr_rate_pct：该代理的 GGR 分成比例（%）。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_agent` (
  `agent_id`      VARCHAR(32)  NOT NULL                COMMENT '代理用户ID（= bg_user.id）',
  `name`          VARCHAR(64)  NOT NULL DEFAULT ''     COMMENT '代理名称/备注名',
  `ggr_rate_pct`  DECIMAL(5,2) NOT NULL DEFAULT 0      COMMENT 'GGR 分成比例（%）',
  `status`        ENUM('active','disabled') NOT NULL DEFAULT 'active',
  `remark`        VARCHAR(255) NOT NULL DEFAULT '',
  `created_by`    INT          NULL                    COMMENT '操作管理员ID',
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`agent_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `fk_agent_user` FOREIGN KEY (`agent_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='代理主体，后台手动指定，享名下用户 GGR 分成';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. bg_agent_channel  代理导流渠道
--    channel_type='domain'：channel_value 为域名（小写、去协议去端口）
--    channel_type='bot'   ：channel_value 为 bot 标识（首版预留，逻辑后补）
--    UNIQUE(channel_type, channel_value) 保证一个渠道只归一个代理。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_agent_channel` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `agent_id`      VARCHAR(32)  NOT NULL,
  `channel_type`  ENUM('domain','bot') NOT NULL,
  `channel_value` VARCHAR(128) NOT NULL                COMMENT '域名或 bot 标识',
  `enabled`       TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_type_value` (`channel_type`, `channel_value`),
  KEY `idx_agent` (`agent_id`),
  CONSTRAINT `fk_channel_agent` FOREIGN KEY (`agent_id`) REFERENCES `bg_agent` (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='代理导流渠道（域名/机器人）';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. bg_user_agent  用户→代理 归因
--    注册时命中渠道写入（source='domain'/'bot'），或后台手动指定（source='manual'）。
--    一个用户最多归属一个代理，与 bg_user.inviter_id 独立共存。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_user_agent` (
  `user_id`    VARCHAR(32) NOT NULL,
  `agent_id`   VARCHAR(32) NOT NULL,
  `source`     ENUM('domain','bot','manual') NOT NULL,
  `bound_by`   INT         NULL                        COMMENT '手动绑定时的管理员ID',
  `bound_at`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  KEY `idx_agent` (`agent_id`),
  CONSTRAINT `fk_ua_user`  FOREIGN KEY (`user_id`)  REFERENCES `bg_user` (`id`),
  CONSTRAINT `fk_ua_agent` FOREIGN KEY (`agent_id`) REFERENCES `bg_agent` (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='用户归属代理，一人一代理，与邀请关系独立';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. bg_agent_ggr_monthly  代理月度 GGR 快照
--    结算时聚合：GGR = Σbet - Σwin - Σ(bonus + red_packet)
--      bet/win    来自 bg_bet_order（bet_type='bet'/'win'）
--      bonus/红利 来自 bg_wallet_ledger（type IN ('bonus','red_packet')）
--    ggr_cents 可为负（玩家整体赢钱月）。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_agent_ggr_monthly` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `agent_id`      VARCHAR(32) NOT NULL,
  `period`        CHAR(7)     NOT NULL                 COMMENT '结算月份，如 2026-06',
  `bet_cents`     BIGINT      NOT NULL DEFAULT 0,
  `win_cents`     BIGINT      NOT NULL DEFAULT 0,
  `bonus_cents`   BIGINT      NOT NULL DEFAULT 0       COMMENT '赠金+红利（扣减项）',
  `ggr_cents`     BIGINT      NOT NULL DEFAULT 0       COMMENT 'GGR = bet - win - bonus，可为负',
  `user_count`    INT         NOT NULL DEFAULT 0       COMMENT '当月有流水的名下用户数',
  `calculated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agent_period` (`agent_id`, `period`),
  KEY `idx_period` (`period`),
  CONSTRAINT `fk_aggm_agent` FOREIGN KEY (`agent_id`) REFERENCES `bg_agent` (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='代理月度 GGR 快照';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. bg_agent_commission  代理月度分成（负 GGR 结转）
--    net_ggr = ggr_cents + carry_in_cents
--      net <= 0 → commission_cents = 0，carry_out_cents = net（负数滚入下期 carry_in）
--      net >  0 → commission_cents = net * rate_pct / 100，carry_out_cents = 0
--    UNIQUE(agent_id, period) 保证结算幂等。仅报表，无钱包/提现。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_agent_commission` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `agent_id`         VARCHAR(32)  NOT NULL,
  `period`           CHAR(7)      NOT NULL             COMMENT '分成月份，如 2026-06',
  `ggr_cents`        BIGINT       NOT NULL DEFAULT 0   COMMENT '当月 GGR（可为负）',
  `carry_in_cents`   BIGINT       NOT NULL DEFAULT 0   COMMENT '上期结转（<=0）',
  `net_ggr_cents`    BIGINT       NOT NULL DEFAULT 0   COMMENT 'ggr + carry_in',
  `carry_out_cents`  BIGINT       NOT NULL DEFAULT 0   COMMENT '结转下期（<=0）',
  `rate_pct`         DECIMAL(5,2) NOT NULL DEFAULT 0,
  `commission_cents` BIGINT       NOT NULL DEFAULT 0   COMMENT '应分金额 = MAX(net,0) * rate / 100',
  `status`           ENUM('pending','paid','voided') NOT NULL DEFAULT 'pending'
                     COMMENT 'pending=待打款 paid=已线下打款 voided=作废',
  `paid_at`          DATETIME(3)  NULL,
  `settled_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agent_period` (`agent_id`, `period`),
  KEY `idx_period_status` (`period`, `status`),
  CONSTRAINT `fk_acom_agent` FOREIGN KEY (`agent_id`) REFERENCES `bg_agent` (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='代理月度分成，负 GGR 结转下期';

SET FOREIGN_KEY_CHECKS = 1;
