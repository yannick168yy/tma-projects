-- 044: 每日流水结算 + 多套费率套餐
--
-- 变更列表：
--   新建 bg_team_rate_plan       — 多套佣金费率套餐
--   新建 bg_team_turnover_daily  — 每日投注流水快照（替代月度 GGR 快照）
--   bg_team_node                 — 加 rate_plan_id（NULL=默认套餐）
--   bg_team_commission           — period 改为 YYYY-MM-DD；加 turnover_cents/currency_breakdown；清空旧数据
--   bg_team_config               — 加 commission_basis；last_auto_settlement 扩为 VARCHAR(10)
--
-- 结算逻辑变更：
--   基数：GGR(bet-win) → 流水(bet)
--   粒度：月度 → 每日
--   负佣金：去掉（流水永远 ≥ 0）
--   套餐：全局单套 → 多套，用户可绑定，NULL 使用 is_default=1 套餐

SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. bg_team_rate_plan  多套佣金费率套餐
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_team_rate_plan` (
  `id`           INT            NOT NULL AUTO_INCREMENT,
  `name`         VARCHAR(64)    NOT NULL                    COMMENT '套餐名称',
  `is_default`   TINYINT(1)     NOT NULL DEFAULT 0          COMMENT '是否为默认套餐（C端广告展示）',
  `l1_rate_pct`  DECIMAL(5,2)   NOT NULL DEFAULT 0.00       COMMENT 'L1 佣金率（%）',
  `l2_rate_pct`  DECIMAL(5,2)   NOT NULL DEFAULT 0.00       COMMENT 'L2 佣金率（%）',
  `l3_rate_pct`  DECIMAL(5,2)   NOT NULL DEFAULT 0.00       COMMENT 'L3 佣金率（%）',
  `created_at`   DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_is_default` (`is_default`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='佣金费率套餐，is_default=1 为 C 端广告展示套餐';

-- 首次安装：从 bg_team_config 种子默认套餐；已存在则保留后台修改的费率（勿覆盖）
INSERT IGNORE INTO `bg_team_rate_plan` (`id`, `name`, `is_default`, `l1_rate_pct`, `l2_rate_pct`, `l3_rate_pct`)
SELECT 1, '默认套餐', 1, l1_rate_pct, l2_rate_pct, l3_rate_pct
FROM `bg_team_config` WHERE id = 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. bg_team_turnover_daily  每日投注流水快照
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_team_turnover_daily` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       VARCHAR(32)     NOT NULL,
  `date`          DATE            NOT NULL                  COMMENT '投注日期（PHT）',
  `currency_code` VARCHAR(32)     NOT NULL DEFAULT 'PHP'    COMMENT '原始投注币种',
  `bet_cents`     BIGINT          NOT NULL DEFAULT 0        COMMENT '当日投注额（原币分）',
  `settled`       TINYINT(1)      NOT NULL DEFAULT 0        COMMENT '佣金是否已结算',
  `created_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_date_currency` (`user_id`, `date`, `currency_code`),
  KEY `idx_date_settled`  (`date`, `settled`),
  CONSTRAINT `fk_ttd_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='每日投注流水快照，结算后 settled=1';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. bg_team_node 加 rate_plan_id；opted_in 可能已存在（027迁移），幂等处理
-- ─────────────────────────────────────────────────────────────────────────────
SET @c = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_team_node' AND COLUMN_NAME = 'rate_plan_id');
SET @s = IF(@c = 0, 'ALTER TABLE `bg_team_node` ADD COLUMN `rate_plan_id` INT NULL DEFAULT NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_team_node' AND COLUMN_NAME = 'opted_in');
SET @s = IF(@c = 0, 'ALTER TABLE `bg_team_node` ADD COLUMN `opted_in` TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. bg_team_commission：清空旧数据 + 改 period 为日期 + 加新字段
-- ─────────────────────────────────────────────────────────────────────────────

-- 先清空（改变结算逻辑，旧月度GGR数据不再有效）
TRUNCATE TABLE `bg_team_commission`;

-- period: CHAR(7) YYYY-MM → CHAR(10) YYYY-MM-DD
ALTER TABLE `bg_team_commission`
  MODIFY COLUMN `period` CHAR(10) NOT NULL COMMENT '结算日期 YYYY-MM-DD';

-- 加新字段（幂等）
SET @c = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_team_commission' AND COLUMN_NAME = 'turnover_cents');
SET @s = IF(@c = 0, 'ALTER TABLE `bg_team_commission` ADD COLUMN `turnover_cents` BIGINT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_team_commission' AND COLUMN_NAME = 'currency_breakdown');
SET @s = IF(@c = 0, 'ALTER TABLE `bg_team_commission` ADD COLUMN `currency_breakdown` JSON NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- 清空 bg_team_ggr_monthly（废弃，新结算不再写此表）
TRUNCATE TABLE `bg_team_ggr_monthly`;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. bg_team_config：加 commission_basis；last_auto_settlement 扩为日期格式
-- ─────────────────────────────────────────────────────────────────────────────
SET @c = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_team_config' AND COLUMN_NAME = 'commission_basis');
SET @s = IF(@c = 0, "ALTER TABLE `bg_team_config` ADD COLUMN `commission_basis` ENUM('ggr','turnover') NOT NULL DEFAULT 'turnover'", 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

ALTER TABLE `bg_team_config`
  MODIFY COLUMN `last_auto_settlement` VARCHAR(10) DEFAULT NULL
    COMMENT '上次自动结算的日期（YYYY-MM-DD），防重复触发';

-- 同步重置钱包（旧佣金已清空，余额归零保持一致性）
-- 注意：仅在开发/测试环境执行；生产环境若有真实提现记录需手动处理
UPDATE `bg_team_wallet`
SET available_cents = 0, frozen_cents = 0, lifetime_earned_cents = 0, version = version + 1;
