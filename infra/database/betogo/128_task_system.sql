-- 128: 任务体系（新手/每日/成就 + 社群关注）
--
-- 设计要点：
--   任务定义硬编码在 task.service.ts（一期不做 def 表），本迁移只建「领取记录」与「社群任务配置」。
--   原生任务进度按需查既有流水表（bg_bet_order / bg_deposit_order），不落进度库，天然对账不漂移。
--   发奖复用 mysql-store.creditWallet；带打码复用 turnover.service.createPromoRequirement。
--
-- 表：
--   bg_task_claim         原生任务领取记录（幂等：user_id + task_id + period_key）
--   bg_task_social        社群关注任务配置（后台可配：平台/验证策略/频道标识/轮换码/奖励）
--   bg_task_social_claim  社群任务领取记录（幂等：user_id + task_key）
--   bg_task_manual_review 截图人工审核队列（manual_review 策略用）
--   bg_wallet_ledger.type 追加 'task_bonus'（防漂移动态追加）
--   bg_user_vip_state.task_growth 任务喂成长值列（三期接入，先建列）

SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. bg_task_claim  原生任务领取记录
--    period_key：每日任务=马尼拉日期 'YYYY-MM-DD'；一次性任务='once'
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_task_claim` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       VARCHAR(32)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_id`       VARCHAR(48)  COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '硬编码任务标识，如 daily_login/daily_deposit/profile_complete/first_withdraw/first_game/invite_1',
  `period_key`    VARCHAR(16)  COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '每日=马尼拉日期，一次性=once',
  `reward_type`   ENUM('cash','spin','growth') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'cash',
  `currency`      VARCHAR(8)   COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP',
  `reward_amount` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '现金奖励',
  `reward_spin`   INT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '转盘次数奖励',
  `turnover_x`    DECIMAL(8,2)  NOT NULL DEFAULT 0 COMMENT '现金奖励打码倍数（0=直接可提）',
  `created_at`    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_task_period` (`user_id`, `task_id`, `period_key`),
  KEY `idx_user` (`user_id`, `task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务领取记录';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. bg_task_social  社群关注任务配置
--    verify_strategy：
--      tg_member    Telegram：Bot 为频道管理员，getChatMember(channel_ref, tg_id) 强验证
--      code_redeem  FB/Viber：主页/社区放轮换码，用户回填 redeem_code 校验（弱验证，配小额）
--      manual_review 截图人工审核
--      bind_only    仅需完成绑定动作（如「绑定 Telegram」任务）
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_task_social` (
  `task_key`        VARCHAR(48)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `platform`        ENUM('telegram','facebook','viber') COLLATE utf8mb4_unicode_ci NOT NULL,
  `verify_strategy` ENUM('tg_member','code_redeem','manual_review','bind_only') COLLATE utf8mb4_unicode_ci NOT NULL,
  `title`           VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `subtitle`        VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `action_url`      VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '跳转链接（去关注/去加群）',
  `channel_ref`     VARCHAR(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT 'TG 频道 chat_id 或 @username（tg_member 用）',
  `redeem_code`     VARCHAR(64)  COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '当前轮换码（code_redeem 用，后台可改）',
  `reward_type`     ENUM('cash','spin','growth') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'cash',
  `currency`        VARCHAR(8)   COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP',
  `reward_amount`   DECIMAL(18,2) NOT NULL DEFAULT 0,
  `reward_spin`     INT UNSIGNED  NOT NULL DEFAULT 0,
  `turnover_x`      DECIMAL(8,2)  NOT NULL DEFAULT 0,
  `enabled`         TINYINT(1)   NOT NULL DEFAULT 0,
  `sort`            INT          NOT NULL DEFAULT 0,
  `updated_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`task_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='社群关注任务配置';

-- 预置 4 个社群任务（默认关闭，运营配好频道/码后再开启）
INSERT IGNORE INTO `bg_task_social`
  (`task_key`, `platform`, `verify_strategy`, `title`, `subtitle`, `action_url`, `channel_ref`, `reward_type`, `reward_amount`, `reward_spin`, `turnover_x`, `enabled`, `sort`) VALUES
  ('bind_telegram',  'telegram', 'bind_only',    '绑定 Telegram',   '绑定后可参与更多福利', '', '', 'spin', 0, 1, 0, 0, 1),
  ('follow_telegram','telegram', 'tg_member',    '关注官方 Telegram 频道', '加入频道领奖励', 'https://t.me/betogo_gaming', '@betogo_gaming', 'cash', 10, 0, 3, 0, 2),
  ('follow_facebook','facebook', 'code_redeem',  '关注官方 Facebook',      '主页领取暗号回填', '', '', 'spin', 0, 1, 0, 0, 3),
  ('follow_viber',   'viber',    'code_redeem',  '加入官方 Viber 社区',    '社区内领取暗号回填', '', '', 'spin', 0, 1, 0, 0, 4);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. bg_task_social_claim  社群任务领取记录（幂等：一人一任务一次）
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_task_social_claim` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`      VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_key`     VARCHAR(48) COLLATE utf8mb4_unicode_ci NOT NULL,
  `verified_via` VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT 'tg_member/code_redeem/manual_review/bind_only',
  `code_used`    VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT 'code_redeem 时用户回填的码（风控留痕）',
  `ip`           VARCHAR(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_task` (`user_id`, `task_key`),
  KEY `idx_task_time` (`task_key`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='社群任务领取记录';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. bg_task_manual_review  截图人工审核队列
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_task_manual_review` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       VARCHAR(32)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_key`      VARCHAR(48)  COLLATE utf8mb4_unicode_ci NOT NULL,
  `screenshot_url` VARCHAR(512) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `status`        ENUM('pending','approved','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `reviewer`      VARCHAR(64)  COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `note`          VARCHAR(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewed_at`   DATETIME(3)  NULL,
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`, `created_at`),
  KEY `idx_user_task` (`user_id`, `task_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='社群任务截图人工审核队列';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. bg_wallet_ledger.type 追加 'task_bonus'（幂等；动态追加，防线上枚举漂移）
-- ─────────────────────────────────────────────────────────────────────────────
SET @col_type = (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_wallet_ledger' AND COLUMN_NAME = 'type'
);
SET @need = IF(@col_type NOT LIKE '%task_bonus%',
  CONCAT(
    'ALTER TABLE `bg_wallet_ledger` MODIFY COLUMN `type` ',
    INSERT(@col_type, LENGTH(@col_type), 0, ",'task_bonus'"),
    ' COLLATE utf8mb4_unicode_ci NOT NULL'
  ),
  'SELECT 1'
);
PREPARE st FROM @need; EXECUTE st; DEALLOCATE PREPARE st;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. bg_user_vip_state.task_growth  任务喂成长值列（三期接入，先建列，幂等守卫）
-- ─────────────────────────────────────────────────────────────────────────────
SET @has_tg = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_user_vip_state' AND COLUMN_NAME = 'task_growth');
SET @sql_tg = IF(@has_tg = 0,
  "ALTER TABLE `bg_user_vip_state` ADD COLUMN `task_growth` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '任务累计喂入的成长值（等效有效流水，加速升级）'",
  'SELECT 1');
PREPARE st_tg FROM @sql_tg; EXECUTE st_tg; DEALLOCATE PREPARE st_tg;
