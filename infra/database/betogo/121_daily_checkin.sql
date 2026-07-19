-- 121: 每日签到活动（主奖=转盘次数，双轨=登录/投注，7天小周期+30天大周期）
-- 只新增签到台账表；发次数复用 bg_spin_chance（source_order_id 幂等），不新建经济表。

CREATE TABLE `bg_checkin_log` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`          VARCHAR(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `checkin_date`     DATE NOT NULL COMMENT '签到日（马尼拉 UTC+8 日期）',
  `track`            ENUM('base','enhanced') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'base' COMMENT '当日轨道：base=仅登录，enhanced=当日有存款或有效投注',
  `streak`           INT UNSIGNED NOT NULL COMMENT '连续签到天数（断签归1）',
  `cycle_day`        TINYINT UNSIGNED NOT NULL COMMENT '7天小周期内第几天 1..7',
  `month_days`       INT UNSIGNED NOT NULL COMMENT '当月累计签到天数（含当天）',
  `base_rule_id`     BIGINT UNSIGNED NULL COMMENT '基础轨所发转盘档 rule_id',
  `base_chances`     INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '基础轨发放次数',
  `enh_rule_id`      BIGINT UNSIGNED NULL COMMENT '增强轨所发转盘档 rule_id',
  `enh_chances`      INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '增强轨额外发放次数',
  `milestone_days`   INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '当日命中的大周期里程碑（0=未命中，7/15/30）',
  `milestone_chances` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '里程碑额外发放次数',
  `created_at`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_date` (`user_id`, `checkin_date`),
  KEY `idx_user_date` (`user_id`, `checkin_date` DESC),
  CONSTRAINT `fk_checkin_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='每日签到台账';
