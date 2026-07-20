-- 159: BI P5 支付通道日聚合（成功率/到账时长监控）
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `bi_daily_channel` (
  `stat_date`  DATE                        NOT NULL,
  `direction`  ENUM('deposit','withdraw')  NOT NULL,
  `channel`    VARCHAR(32)                 NOT NULL,
  `total`      INT                         NOT NULL DEFAULT 0 COMMENT '当日终态订单数(充值:paid/failed/rejected/admin_rejected;提现:completed/failed/rejected/admin_rejected)',
  `success`    INT                         NOT NULL DEFAULT 0,
  `avg_secs`   INT                         NULL COMMENT '成功单平均处理秒数',
  `updated_at` DATETIME(3)                 NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`stat_date`, `direction`, `channel`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 支付通道日聚合';
