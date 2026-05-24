-- BetoGo 业务库表结构 v1
-- 库名: betogo | 金额单位: 分（PHP cents，BIGINT）
-- 执行: mysql -h127.0.0.1 -P3306 -ubetogo -p betogo < infra/database/betogo/001_schema.sql

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ── 用户 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_user` (
  `id`              VARCHAR(32)  NOT NULL COMMENT '平台用户ID，如 BG-10001',
  `telegram_user_id` BIGINT UNSIGNED NULL COMMENT 'Telegram user.id',
  `google_sub`      VARCHAR(64)  NULL COMMENT 'Google OAuth sub',
  `email`           VARCHAR(255) NULL,
  `display_name`    VARCHAR(128) NOT NULL DEFAULT '',
  `avatar_url`      VARCHAR(512) NULL,
  `invite_code`     CHAR(8)      NOT NULL COMMENT '邀请码，唯一',
  `inviter_id`      VARCHAR(32)  NULL COMMENT '邀请人 bg_user.id',
  `locale`          VARCHAR(10)  NOT NULL DEFAULT 'en' COMMENT 'en|id|vi|zh-CN',
  `status`          ENUM('active','frozen','banned') NOT NULL DEFAULT 'active',
  `status_reason`   VARCHAR(255) NULL,
  `registered_at`   DATETIME(3)  NOT NULL,
  `created_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_telegram_user_id` (`telegram_user_id`),
  UNIQUE KEY `uk_google_sub` (`google_sub`),
  UNIQUE KEY `uk_invite_code` (`invite_code`),
  KEY `idx_inviter_id` (`inviter_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户主表';

CREATE TABLE IF NOT EXISTS `bg_user_profile` (
  `user_id`       VARCHAR(32) NOT NULL,
  `first_name`    VARCHAR(64) NOT NULL DEFAULT '',
  `last_name`     VARCHAR(64) NOT NULL DEFAULT '',
  `gender`        ENUM('','male','female','other') NOT NULL DEFAULT '',
  `dob_month`     CHAR(2)     NOT NULL DEFAULT '',
  `dob_day`       CHAR(2)     NOT NULL DEFAULT '',
  `dob_year`      CHAR(4)     NOT NULL DEFAULT '',
  `phone`         VARCHAR(32) NULL,
  `created_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_profile_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户资料';

CREATE TABLE IF NOT EXISTS `bg_user_promo_state` (
  `user_id`                 VARCHAR(32) NOT NULL,
  `trial_claimed`           TINYINT(1)  NOT NULL DEFAULT 0,
  `referral_claimed`        TINYINT(1)  NOT NULL DEFAULT 0,
  `first_dep_claimed`       TINYINT(1)  NOT NULL DEFAULT 0,
  `referral_ready`          TINYINT(1)  NOT NULL DEFAULT 0 COMMENT '邀请人可领',
  `first_dep_ready`         TINYINT(1)  NOT NULL DEFAULT 0,
  `referral_milestone_met`  TINYINT(1)  NOT NULL DEFAULT 0 COMMENT '被邀请人首充已判定',
  `updated_at`              DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_promo_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='活动/邀请状态';

-- ── 会话（可选持久化；当前 BFF 以 Redis 为主）────────────────
CREATE TABLE IF NOT EXISTS `bg_session` (
  `token`         CHAR(64)     NOT NULL,
  `user_id`       VARCHAR(32)  NOT NULL,
  `expires_at`    DATETIME(3)  NOT NULL,
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`token`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_expires_at` (`expires_at`),
  CONSTRAINT `fk_session_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='登录会话';

-- ── 钱包 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_wallet` (
  `user_id`         VARCHAR(32) NOT NULL,
  `available_cents` BIGINT      NOT NULL DEFAULT 0 COMMENT '可用余额（分）',
  `frozen_cents`    BIGINT      NOT NULL DEFAULT 0 COMMENT '冻结（提现中等）',
  `version`         INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '乐观锁',
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_wallet_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='钱包余额';

CREATE TABLE IF NOT EXISTS `bg_wallet_ledger` (
  `id`              VARCHAR(40) NOT NULL COMMENT '流水ID',
  `user_id`         VARCHAR(32) NOT NULL,
  `type`            ENUM('deposit','withdraw','bet','win','red_packet','bonus','adjust') NOT NULL,
  `amount_cents`    BIGINT      NOT NULL COMMENT '变动额，正负',
  `balance_after`   BIGINT      NOT NULL,
  `ref_type`        VARCHAR(32) NULL COMMENT 'deposit_order|withdraw_order|bet_order|promo',
  `ref_id`          VARCHAR(64) NULL,
  `description`     VARCHAR(255) NOT NULL DEFAULT '',
  `trace_id`        VARCHAR(64) NULL,
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_user_created` (`user_id`, `created_at` DESC),
  KEY `idx_ref` (`ref_type`, `ref_id`),
  KEY `idx_type` (`type`),
  CONSTRAINT `fk_ledger_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='钱包流水（只追加）';

-- ── 充提 ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_deposit_order` (
  `order_id`        VARCHAR(40) NOT NULL,
  `user_id`         VARCHAR(32) NOT NULL,
  `amount`          DECIMAL(18,8) NOT NULL COMMENT '下单面额（PHP 或 USDT 数量）',
  `currency`        ENUM('PHP','USDT') NOT NULL,
  `credited_cents`  BIGINT      NULL COMMENT '入账 PHP 分',
  `channel_id`      VARCHAR(32) NOT NULL DEFAULT 'tg_wallet',
  `status`          ENUM('pending','paid','failed','cancelled') NOT NULL DEFAULT 'pending',
  `provider`        VARCHAR(32) NULL DEFAULT 'ammer_pay',
  `provider_ref`    VARCHAR(128) NULL,
  `tg_payload`      JSON        NULL,
  `paid_at`         DATETIME(3) NULL,
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`order_id`),
  KEY `idx_user_status` (`user_id`, `status`),
  KEY `idx_created` (`created_at`),
  CONSTRAINT `fk_deposit_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='充值订单';

CREATE TABLE IF NOT EXISTS `bg_withdraw_order` (
  `order_id`        VARCHAR(40) NOT NULL,
  `user_id`         VARCHAR(32) NOT NULL,
  `amount_cents`    BIGINT      NOT NULL,
  `currency`        CHAR(3)     NOT NULL DEFAULT 'PHP',
  `channel_id`      VARCHAR(32) NOT NULL DEFAULT 'tg_wallet',
  `status`          ENUM('pending','processing','completed','rejected','failed') NOT NULL DEFAULT 'pending',
  `reject_reason`   VARCHAR(255) NULL,
  `completed_at`    DATETIME(3) NULL,
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`order_id`),
  KEY `idx_user_status` (`user_id`, `status`),
  CONSTRAINT `fk_withdraw_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='提现订单';

-- ── KYC ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_kyc_submission` (
  `submission_id`   VARCHAR(40) NOT NULL,
  `user_id`         VARCHAR(32) NOT NULL,
  `status`          ENUM('none','pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `full_name`       VARCHAR(128) NOT NULL DEFAULT '',
  `gender`          VARCHAR(16)  NOT NULL DEFAULT '',
  `dob`             DATE         NULL,
  `doc_type`        VARCHAR(32)  NULL,
  `file_ids`        JSON         NULL,
  `reject_reason`   VARCHAR(255) NULL,
  `submitted_at`    DATETIME(3)  NOT NULL,
  `reviewed_at`     DATETIME(3)  NULL,
  PRIMARY KEY (`submission_id`),
  KEY `idx_user` (`user_id`),
  CONSTRAINT `fk_kyc_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='KYC 提交';

-- ── 活动 / 邀请记录 ───────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_promo_claim` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       VARCHAR(32) NOT NULL,
  `promo_id`      VARCHAR(32) NOT NULL COMMENT 'trial|referral|firstdep',
  `amount_cents`  BIGINT      NOT NULL,
  `claimed_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_promo` (`user_id`, `promo_id`),
  CONSTRAINT `fk_claim_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='活动领取记录';

CREATE TABLE IF NOT EXISTS `bg_referral_record` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `inviter_id`      VARCHAR(32) NOT NULL,
  `invitee_id`      VARCHAR(32) NOT NULL,
  `role`            ENUM('inviter','invitee') NOT NULL,
  `status`          VARCHAR(32) NOT NULL DEFAULT 'pending',
  `reward_cents`    BIGINT      NULL,
  `qualified_at`    DATETIME(3) NULL COMMENT '被邀请人首充达标时间',
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_invitee` (`invitee_id`),
  KEY `idx_inviter` (`inviter_id`),
  CONSTRAINT `fk_ref_inviter` FOREIGN KEY (`inviter_id`) REFERENCES `bg_user` (`id`),
  CONSTRAINT `fk_ref_invitee` FOREIGN KEY (`invitee_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='邀请关系与奖励';

-- ── 游戏 / 竞彩（v0.3+ 聚合商）────────────────────────
CREATE TABLE IF NOT EXISTS `bg_bet_order` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`           VARCHAR(32) NOT NULL,
  `aggregator_id`     VARCHAR(32) NOT NULL,
  `provider_id`       VARCHAR(64) NOT NULL,
  `provider_txn_id`   VARCHAR(128) NOT NULL COMMENT '聚合商幂等键',
  `round_id`          VARCHAR(128) NULL,
  `bet_type`          ENUM('bet','win','refund','cancel') NOT NULL,
  `amount_cents`      BIGINT      NOT NULL,
  `status`            ENUM('pending','settled','failed') NOT NULL DEFAULT 'pending',
  `trace_id`          VARCHAR(64) NULL,
  `created_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `settled_at`        DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_provider_txn` (`aggregator_id`, `provider_txn_id`),
  KEY `idx_user_created` (`user_id`, `created_at` DESC),
  CONSTRAINT `fk_bet_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='竞彩/游戏账变关联单';

CREATE TABLE IF NOT EXISTS `bg_game_session` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`         VARCHAR(32) NOT NULL,
  `game_id`         VARCHAR(64) NOT NULL,
  `provider_id`     VARCHAR(64) NOT NULL,
  `status`          ENUM('active','closed') NOT NULL DEFAULT 'active',
  `device_id`       VARCHAR(64) NULL,
  `started_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `ended_at`        DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_user_active` (`user_id`, `status`),
  CONSTRAINT `fk_gs_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='单活跃游戏会话';

-- ── 幂等 / 回调 ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_idempotency` (
  `idempotency_key` VARCHAR(191) NOT NULL,
  `scope`           VARCHAR(32)  NOT NULL COMMENT 'callback|deposit|withdraw',
  `response_snapshot` JSON       NULL,
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expires_at`      DATETIME(3) NOT NULL,
  PRIMARY KEY (`idempotency_key`),
  KEY `idx_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='HTTP 幂等';

SET FOREIGN_KEY_CHECKS = 1;
