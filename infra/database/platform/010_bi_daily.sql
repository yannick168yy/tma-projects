-- P2-11 平台总览 BI：各租户库抽数汇总到平台库。
--
-- 🔴 不做实时跨库 UNION：租户数上去以后，一次总览查询会同时压所有租户库，
-- 而且任何一个库慢就整页转圈。抽数落一张宽表，总览只查平台库。
--
-- 与 pf_billing_daily 分开：计费快照出账后必须锁定不可变，而 BI 要能随时重算回填。
-- 同一张表兼顾两个相反的要求，最后一定是其中一个被牺牲。
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `pf_bi_daily` (
  `tenant_id`      INT UNSIGNED NOT NULL,
  `stat_date`      DATE NOT NULL,
  -- 统一折 USDT：跨租户对比是这张表存在的唯一理由，不折算就没法横向排名
  `deposit_usdt`   DECIMAL(18,4) NOT NULL DEFAULT 0,
  `withdraw_usdt`  DECIMAL(18,4) NOT NULL DEFAULT 0,
  `turnover_usdt`  DECIMAL(18,4) NOT NULL DEFAULT 0,
  `payout_usdt`    DECIMAL(18,4) NOT NULL DEFAULT 0,
  `ggr_usdt`       DECIMAL(18,4) NOT NULL DEFAULT 0,
  `bonus_usdt`     DECIMAL(18,4) NOT NULL DEFAULT 0,
  `commission_usdt` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `deposit_count`  INT NOT NULL DEFAULT 0,
  `deposit_users`  INT NOT NULL DEFAULT 0,
  `first_dep_users` INT NOT NULL DEFAULT 0,
  `bet_users`      INT NOT NULL DEFAULT 0,
  `new_users`      INT NOT NULL DEFAULT 0,
  `dau`            INT NOT NULL DEFAULT 0,
  -- 汇率缺失的币种不参与折算，这里记下有几行被跳过：
  -- 总览数字偏小时要能一眼看出是「生意差」还是「汇率没抓到」
  `skipped_rows`   INT NOT NULL DEFAULT 0,
  `updated_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenant_id`, `stat_date`),
  KEY `idx_bi_date` (`stat_date`),
  CONSTRAINT `fk_bi_daily_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='平台总览日汇总（各租户库抽数）';
