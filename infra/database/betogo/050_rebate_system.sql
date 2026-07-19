-- 050: 洗码（Cash Rebate）功能
--
-- 变更列表：
--   bg_wallet_ledger.type ENUM 新增 'rebate'
--   新建 bg_rebate_config         — 各游戏大类洗码比例（后台可配置）
--   新建 bg_rebate_record         — 每日洗码结算快照（每用户·每大类·每币种）
--   新建 bg_rebate_featured_game  — Cashback Games 精选游戏（后台配置展示档位）

SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. bg_wallet_ledger.type 新增 'rebate'
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE `bg_wallet_ledger`
  MODIFY COLUMN `type`
    ENUM('deposit','withdraw','bet','win','red_packet','bonus','adjust','admin_adjust','rebate')
    COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '账变类型';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. bg_rebate_config  各游戏大类洗码比例
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_rebate_config` (
  `game_category` VARCHAR(32)   NOT NULL                    COMMENT '游戏大类（与 bg_turnover_logs.sort_category 对应）',
  `rate_pct`      DECIMAL(5,3)  NOT NULL DEFAULT 0.800      COMMENT '洗码比例 %（1.000 = 1%）',
  `enabled`       TINYINT(1)    NOT NULL DEFAULT 1           COMMENT '是否参与洗码',
  `updated_at`    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`game_category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='洗码费率配置，后台可调整各游戏大类比例';

-- 默认费率（首次安装；已存在的行保留后台改过的值）
INSERT IGNORE INTO `bg_rebate_config` (`game_category`, `rate_pct`) VALUES
  ('slots',   1.000),
  ('live',    0.800),
  ('sports',  0.800),
  ('fishing', 1.000),
  ('table',   0.800),
  ('bingo',   0.800),
  ('crash',   0.800),
  ('pinoy',   0.800),
  ('other',   0.800);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. bg_rebate_record  每日洗码结算快照
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_rebate_record` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       VARCHAR(32)     NOT NULL,
  `date`          DATE            NOT NULL                   COMMENT '投注日期（PHT）',
  `game_category` VARCHAR(32)     NOT NULL                   COMMENT '游戏大类',
  `currency_code` VARCHAR(32)     NOT NULL DEFAULT 'PHP',
  `bet_amount`    DECIMAL(18,4)   NOT NULL DEFAULT 0         COMMENT '当日投注额',
  `rebate_amount` DECIMAL(18,4)   NOT NULL DEFAULT 0         COMMENT '洗码返还金额',
  `rate_pct`      DECIMAL(5,3)    NOT NULL                   COMMENT '结算时使用的费率',
  `status`        ENUM('pending','paid') NOT NULL DEFAULT 'pending',
  `paid_at`       DATETIME(3)     NULL,
  `created_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_date_cat_cur` (`user_id`, `date`, `game_category`, `currency_code`),
  KEY `idx_date_status` (`date`, `status`),
  KEY `idx_user_date`   (`user_id`, `date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='每日洗码结算快照，凌晨定时任务写入并自动派发';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. bg_rebate_featured_game  Cashback Games 精选游戏展示
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_rebate_featured_game` (
  `id`         INT          NOT NULL AUTO_INCREMENT,
  `game_uuid`  VARCHAR(64)  NOT NULL                    COMMENT 'sg_games.uuid',
  `tier`       VARCHAR(16)  NOT NULL DEFAULT 'elite'    COMMENT 'elite（2%档）| pro（1.5%档）',
  `sort_order` INT          NOT NULL DEFAULT 0          COMMENT '展示排序（升序）',
  `enabled`    TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_game_tier` (`game_uuid`, `tier`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='洗码精选游戏（后台配置，C端展示噱头分档）';
