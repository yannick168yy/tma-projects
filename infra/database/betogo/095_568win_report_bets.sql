-- 095: 568Win 报表注单原始数据
SET NAMES utf8mb4;

CREATE TABLE `bg_568win_report_bet` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `portfolio`         VARCHAR(32)     NOT NULL COMMENT '568Win portfolio',
  `ref_no`            VARCHAR(64)     NOT NULL COMMENT '568Win RefNo',
  `external_username` VARCHAR(40)     NULL COMMENT '568Win Username',
  `currency`          VARCHAR(16)     NULL,
  `status`            VARCHAR(32)     NULL,
  `stake`             DECIMAL(18,4)   NULL,
  `win_lost`          DECIMAL(18,4)   NULL,
  `order_time`        DATETIME(3)     NULL,
  `settle_time`       DATETIME(3)     NULL,
  `win_lost_date`     DATETIME(3)     NULL,
  `modify_date`       DATETIME(3)     NULL,
  `raw_bet`           JSON            NOT NULL,
  `raw_response`      JSON            NULL,
  `fetched_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`        DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_portfolio_ref` (`portfolio`, `ref_no`),
  KEY `idx_username` (`external_username`),
  KEY `idx_order_time` (`order_time`),
  KEY `idx_modify_date` (`modify_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='568Win 报表注单原始数据';
