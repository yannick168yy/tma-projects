-- 158: BI P3 用户日聚合表 + 业务表时间范围索引
-- bi_daily_user 支撑 LTV/RFM/盈利榜；bi_user_active_day 支撑留存 cohort。
-- 业务表补 created_at 索引：BI 聚合按纯时间窗扫描，原表只有 (user_id, created_at)
-- 复合索引无法命中，趁数据量小补齐（在线 DDL 秒级完成）。
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `bi_daily_user` (
  `stat_date`       DATE          NOT NULL,
  `user_id`         VARCHAR(32)   NOT NULL,
  `currency`        VARCHAR(32)   NOT NULL,
  `bet_amount`      DECIMAL(18,4) NOT NULL DEFAULT 0,
  `payout_amount`   DECIMAL(18,4) NOT NULL DEFAULT 0,
  `bet_count`       INT           NOT NULL DEFAULT 0,
  `deposit_amount`  DECIMAL(18,4) NOT NULL DEFAULT 0,
  `withdraw_amount` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `bonus_amount`    DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '当日领取彩金(ledger bonus类正数)',
  PRIMARY KEY (`stat_date`, `user_id`, `currency`),
  KEY `idx_user` (`user_id`, `stat_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 用户日聚合(有资金行为)';

CREATE TABLE IF NOT EXISTS `bi_user_active_day` (
  `stat_date` DATE        NOT NULL,
  `user_id`   VARCHAR(32) NOT NULL,
  PRIMARY KEY (`stat_date`, `user_id`),
  KEY `idx_user` (`user_id`, `stat_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 用户活跃日(登录∪投注∪充值),留存用';

-- 幂等补时间索引
SET @add_idx = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_login_log' AND INDEX_NAME='idx_created');
SET @sql = IF(@add_idx=0, 'CREATE INDEX idx_created ON bg_login_log (created_at)', 'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @add_idx = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_568win_wallet_txn' AND INDEX_NAME='idx_created');
SET @sql = IF(@add_idx=0, 'CREATE INDEX idx_created ON bg_568win_wallet_txn (created_at)', 'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @add_idx = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_wallet_ledger' AND INDEX_NAME='idx_created');
SET @sql = IF(@add_idx=0, 'CREATE INDEX idx_created ON bg_wallet_ledger (created_at)', 'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @add_idx = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_deposit_order' AND INDEX_NAME='idx_created');
SET @sql = IF(@add_idx=0, 'CREATE INDEX idx_created ON bg_deposit_order (created_at)', 'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @add_idx = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_withdraw_order' AND INDEX_NAME='idx_created');
SET @sql = IF(@add_idx=0, 'CREATE INDEX idx_created ON bg_withdraw_order (created_at)', 'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @add_idx = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_user' AND INDEX_NAME='idx_registered');
SET @sql = IF(@add_idx=0, 'CREATE INDEX idx_registered ON bg_user (registered_at)', 'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
