-- 运营引擎 P1 地基：用户分层快照表。
-- 每日 cron 全量重算一行/用户，供触达中心「选人群」与定向发券做定向过滤。
-- 宽表快照（非 tall tag 表）：分层维度都是索引列，便于 WHERE 组合筛人群。
CREATE TABLE IF NOT EXISTS `bg_user_segment` (
  `user_id`             VARCHAR(32) NOT NULL,
  `lifecycle`           ENUM('new','active','dormant','churned') NOT NULL DEFAULT 'new' COMMENT '生命周期：新客/活跃/沉睡/流失',
  `deposited`           TINYINT(1)  NOT NULL DEFAULT 0 COMMENT '是否充过值',
  `value_tier`          ENUM('none','low','mid','high','vip') NOT NULL DEFAULT 'none' COMMENT '累计充值价值档',
  `is_agent`            TINYINT(1)  NOT NULL DEFAULT 0 COMMENT '是否 3-Circle 已激活代理',
  `reachable_tg`        TINYINT(1)  NOT NULL DEFAULT 0 COMMENT '是否可 Telegram bot 触达（有 telegram_user_id）',
  `total_deposit`       DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '累计充值（PHP，等价 credited_cents 单位）',
  `deposit_count`       INT         NOT NULL DEFAULT 0 COMMENT '成功充值笔数',
  `last_active_at`      DATETIME(3) NULL COMMENT '最近活跃时间（登录/充值取大）',
  `days_since_active`   INT         NULL COMMENT '距今未活跃天数（重算时快照）',
  `computed_at`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  KEY `idx_lifecycle` (`lifecycle`),
  KEY `idx_value_tier` (`value_tier`),
  KEY `idx_deposited` (`deposited`),
  KEY `idx_reachable_tg` (`reachable_tg`),
  KEY `idx_is_agent` (`is_agent`),
  CONSTRAINT `fk_segment_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户分层快照（每日重算，供触达定向）';
