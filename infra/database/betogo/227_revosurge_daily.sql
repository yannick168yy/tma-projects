-- 227: RevoSurge 回传日计数
-- 成功的上报不落明细（走 Redis 去重键，见 revosurge.service），但完全不记会留下
-- 沉默故障的口子：cron 挂掉时既无成功也无失败记录，bg_capi_event 干干净净看起来一切正常，
-- 而广告还在烧钱、对方却收不到任何转化。这张表按天按事件聚合，一天最多 19 行。
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `bg_revosurge_daily` (
  `stat_date`  DATE        NOT NULL,
  `event_name` VARCHAR(32) NOT NULL,
  `sent`       INT         NOT NULL DEFAULT 0,
  `failed`     INT         NOT NULL DEFAULT 0,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`stat_date`, `event_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='RevoSurge 回传日计数（监控用，非对账依据）';
