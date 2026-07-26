-- 176: 投放渠道单价（CPA）配置
--   按短码一条线一个价（USD/有效首存），投放渠道分析页用它算回本倍数与 LTV 成本线。
--   与像素表解耦：一条线 FB/TT 两行像素共用一个短码、一个单价。
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `bg_ad_channel_price` (
  `channel_code` VARCHAR(64)   NOT NULL,
  `cpa_usd`      DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '每有效首存单价(USD),0=未定价',
  `remark`       VARCHAR(191)      NULL,
  `updated_at`   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`channel_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='投放渠道CPA单价配置';
