-- 157: BI 数据分析日聚合表（P1）
-- 方案见 docs/bi-analytics-plan.md。全部为独立聚合表，不改动任何业务表。
-- 统计日按 Asia/Manila（UTC+8）边界；金额按币种原币存储，展示层折算 PHP。
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `bi_daily_platform` (
  `stat_date`        DATE            NOT NULL,
  `currency`         VARCHAR(32)     NOT NULL,
  `deposit_amount`   DECIMAL(18,4)   NOT NULL DEFAULT 0 COMMENT '当日已支付充值总额',
  `deposit_count`    INT             NOT NULL DEFAULT 0,
  `deposit_users`    INT             NOT NULL DEFAULT 0 COMMENT '充值人数(去重)',
  `withdraw_amount`  DECIMAL(18,4)   NOT NULL DEFAULT 0 COMMENT '当日提现总额(completed+processing)',
  `withdraw_count`   INT             NOT NULL DEFAULT 0,
  `bet_amount`       DECIMAL(18,4)   NOT NULL DEFAULT 0 COMMENT '当日投注总额(非void)',
  `payout_amount`    DECIMAL(18,4)   NOT NULL DEFAULT 0 COMMENT '当日派彩总额(settled win_loss,含本金)',
  `bet_count`        INT             NOT NULL DEFAULT 0,
  `bet_users`        INT             NOT NULL DEFAULT 0 COMMENT '投注人数(去重)',
  `bonus_cost`       DECIMAL(18,4)   NOT NULL DEFAULT 0 COMMENT '活动成本=ledger bonus/red_packet/rebate/vip_bonus/task_bonus 正数合计',
  `first_dep_users`  INT             NOT NULL DEFAULT 0 COMMENT '首充人数(平台首笔已支付充值发生在当日)',
  `first_dep_amount` DECIMAL(18,4)   NOT NULL DEFAULT 0,
  `updated_at`       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`stat_date`, `currency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 平台日聚合(按币种)';

CREATE TABLE IF NOT EXISTS `bi_daily_active` (
  `stat_date`   DATE         NOT NULL,
  `new_users`   INT          NOT NULL DEFAULT 0 COMMENT '当日注册数',
  `dau`         INT          NOT NULL DEFAULT 0 COMMENT '当日活跃=登录∪投注∪充值 去重',
  `login_count` INT          NOT NULL DEFAULT 0 COMMENT '当日登录次数',
  `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`stat_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 用户活跃日聚合(不分币种)';

CREATE TABLE IF NOT EXISTS `bi_daily_provider` (
  `stat_date`     DATE          NOT NULL,
  `provider`      VARCHAR(128)  NOT NULL COMMENT '厂商规范名(bg_568win_game.provider),未匹配=Unknown',
  `currency`      VARCHAR(32)   NOT NULL,
  `bet_count`     INT           NOT NULL DEFAULT 0,
  `bet_users`     INT           NOT NULL DEFAULT 0,
  `bet_amount`    DECIMAL(18,4) NOT NULL DEFAULT 0,
  `payout_amount` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `updated_at`    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`stat_date`, `provider`, `currency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 游戏厂商日聚合';

CREATE TABLE IF NOT EXISTS `bi_daily_game` (
  `stat_date`        DATE          NOT NULL,
  `game_provider_id` INT           NOT NULL COMMENT '=bg_568win_game.game_provider_id(gpid)',
  `game_id`          INT           NOT NULL COMMENT '=bg_568win_game.game_id',
  `currency`         VARCHAR(32)   NOT NULL,
  `bet_count`        INT           NOT NULL DEFAULT 0,
  `bet_users`        INT           NOT NULL DEFAULT 0,
  `bet_amount`       DECIMAL(18,4) NOT NULL DEFAULT 0,
  `payout_amount`    DECIMAL(18,4) NOT NULL DEFAULT 0,
  `updated_at`       DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`stat_date`, `game_provider_id`, `game_id`, `currency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 游戏日聚合,游戏名读时join';

CREATE TABLE IF NOT EXISTS `bi_daily_acquisition` (
  `stat_date`       DATE         NOT NULL,
  `entry_source`    VARCHAR(255) NOT NULL COMMENT '入口域名或tma,空=unknown',
  `new_users`       INT          NOT NULL DEFAULT 0 COMMENT '按注册入口归因',
  `dau`             INT          NOT NULL DEFAULT 0 COMMENT '按当日登录入口归因',
  `first_dep_users` INT          NOT NULL DEFAULT 0 COMMENT '首充人数,按注册入口归因',
  `updated_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`stat_date`, `entry_source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 渠道(域名/tma)日聚合';

CREATE TABLE IF NOT EXISTS `bi_target` (
  `period`       CHAR(7)       NOT NULL COMMENT '月份 YYYY-MM',
  `metric`       VARCHAR(32)   NOT NULL COMMENT 'ggr|deposit|new_users|first_dep_users',
  `target_value` DECIMAL(18,4) NOT NULL,
  `created_by`   VARCHAR(64)   NULL,
  `updated_at`   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`period`, `metric`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 月度运营目标(P4 使用)';

CREATE TABLE IF NOT EXISTS `bi_alert` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `stat_date`  DATE          NOT NULL,
  `alert_type` VARCHAR(32)   NOT NULL COMMENT 'provider_rtp|channel_success|ggr|withdraw|new_users',
  `dimension`  VARCHAR(128)  NOT NULL DEFAULT '' COMMENT '维度值,如厂商名/通道名',
  `currency`   VARCHAR(32)   NOT NULL DEFAULT '',
  `value`      DECIMAL(18,4) NOT NULL,
  `baseline`   DECIMAL(18,4) NOT NULL,
  `deviation`  DECIMAL(8,2)  NOT NULL COMMENT 'z-score',
  `severity`   VARCHAR(16)   NOT NULL DEFAULT 'warn' COMMENT 'warn|critical',
  `status`     VARCHAR(16)   NOT NULL DEFAULT 'open' COMMENT 'open|ack|closed',
  `created_at` DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_alert` (`stat_date`, `alert_type`, `dimension`, `currency`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 异常告警(P2 起使用)';
