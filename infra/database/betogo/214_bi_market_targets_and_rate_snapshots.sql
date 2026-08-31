-- BI 市场维度目标与历史汇率快照。
SET NAMES utf8mb4;

ALTER TABLE `bi_target`
  DROP PRIMARY KEY,
  ADD COLUMN `market` VARCHAR(8) NOT NULL DEFAULT 'ALL' AFTER `period`,
  ADD PRIMARY KEY (`period`, `market`, `metric`);

ALTER TABLE `bi_daily_active`
  DROP PRIMARY KEY,
  ADD COLUMN `market` VARCHAR(8) NOT NULL DEFAULT 'ALL' AFTER `stat_date`,
  ADD PRIMARY KEY (`stat_date`, `market`);

CREATE TABLE `bi_daily_exchange_rate` (
  `stat_date` DATE NOT NULL,
  `currency` VARCHAR(32) NOT NULL,
  `rate_to_usdt` DECIMAL(24,12) NOT NULL COMMENT '1 原币折合 USDT',
  `source` VARCHAR(32) NOT NULL DEFAULT 'exchange_rate',
  `captured_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`stat_date`, `currency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 每日原币兑 USDT 汇率快照';
