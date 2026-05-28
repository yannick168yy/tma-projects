-- 014: 汇率表 + bg_bet_order 增加原始币种列 + SG 日结算报告表
-- 幂等：ALTER 前先检查列是否存在

-- ── 1. 实时汇率缓存表 ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_exchange_rate` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `currency_from` CHAR(5)         NOT NULL COMMENT '来源币种，如 EUR/USDT',
  `currency_to`   CHAR(5)         NOT NULL COMMENT '目标币种，如 PHP',
  `rate`          DECIMAL(18,8)   NOT NULL COMMENT '1 currency_from = rate currency_to',
  `source`        VARCHAR(64)     NOT NULL DEFAULT 'exchangerate-api',
  `fetched_at`    DATETIME(3)     NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pair_fetched` (`currency_from`, `currency_to`, `fetched_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='第三方汇率快照，每小时刷新一次';

-- ── 2. bg_bet_order 增加原始币种列（幂等：检查 information_schema）────────────
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'bg_bet_order'
    AND COLUMN_NAME  = 'currency_code'
);
SET @add_cols = CONCAT(
  'ALTER TABLE `bg_bet_order`',
  ' ADD COLUMN `currency_code`   CHAR(3)       NOT NULL DEFAULT ', QUOTE('PHP'), ' AFTER `amount_cents`,',
  ' ADD COLUMN `original_amount` DECIMAL(18,4) NULL AFTER `currency_code`,',
  ' ADD COLUMN `exchange_rate`   DECIMAL(18,8) NULL AFTER `original_amount`'
);
SET @sql = IF(@col_exists = 0, @add_cols, 'SELECT 1 AS skipped');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 3. SG 日结算报告表 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `sg_settlement_report` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `report_date`     DATE            NOT NULL COMMENT '结算日期（UTC）',
  `currency`        CHAR(3)         NOT NULL COMMENT 'SG 结算币种',
  `sg_bet_amount`   DECIMAL(18,4)   NOT NULL DEFAULT 0 COMMENT 'SG 报告总投注（原币）',
  `sg_win_amount`   DECIMAL(18,4)   NOT NULL DEFAULT 0 COMMENT 'SG 报告总派彩（原币）',
  `sg_ggr`          DECIMAL(18,4)   NOT NULL DEFAULT 0 COMMENT 'SG GGR = bet - win（原币）',
  `sg_round_count`  INT UNSIGNED    NOT NULL DEFAULT 0,
  `local_bet_cents` BIGINT          NOT NULL DEFAULT 0 COMMENT '本地 bg_bet_order 投注总分',
  `local_win_cents` BIGINT          NOT NULL DEFAULT 0 COMMENT '本地 bg_bet_order 派彩总分',
  `discrepancy_note` TEXT           NULL     COMMENT '差异说明，NULL 表示核对一致',
  `raw_data`        JSON            NULL     COMMENT 'SG 原始响应快照',
  `fetched_at`      DATETIME(3)     NOT NULL,
  `reconciled`      TINYINT(1)      NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_date_currency` (`report_date`, `currency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Slotegrator 日结算报告及本地核对结果';
