-- 126: VIP 成长体系（一期）
--
-- 复用现有洗码等级（bg_rebate_level_threshold / bg_rebate_level_config）作为唯一 VIP 等级来源，
-- 从 LV1–6 平滑扩展到 LV1–9（LV1 为入门级，累计有效流水 = 0 即达到）。
-- 在等级之上新增三项权益：晋级礼金、负盈利返水（一期）、周俸/月俸/保级线（预置，二期启用）。
--
-- 变更列表：
--   bg_rebate_level_threshold  阈值扩展到 9 级，并按 VIP 方案重置预设值（后台可再调）
--   bg_rebate_level_config     为 LV7–9 播种费率（复制 LV6），使新等级也能正常洗码
--   新建 bg_vip_level_benefit  每级权益数值（晋级礼金/周俸/月俸/负盈利返水率/保级线），后台可配
--   新建 bg_vip_reward_log     VIP 各类礼金发放记录（pending 待领取 / paid 已领取），幂等防重发
--   bg_wallet_ledger.type ENUM 追加 'vip_bonus'（幂等，保留现有枚举值防漂移）

SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. 等级阈值扩展到 9 级（LV1 固定 0；其余按 VIP 方案预设，后台可再调）
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO `bg_rebate_level_threshold` (`level`, `min_turnover`) VALUES
  (1, 0),
  (2, 1000),
  (3, 5000),
  (4, 20000),
  (5, 60000),
  (6, 150000),
  (7, 400000),
  (8, 1000000),
  (9, 3000000)
ON DUPLICATE KEY UPDATE `min_turnover` = VALUES(`min_turnover`);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. 为 LV7–9 播种洗码费率矩阵（复制 LV6 各大类费率，后台再分级调整）
-- ─────────────────────────────────────────────────────────────────────────────
INSERT IGNORE INTO `bg_rebate_level_config` (`level`, `game_category`, `rate_pct`, `max_bonus`, `enabled`)
SELECT lv.`level`, c6.`game_category`, c6.`rate_pct`, c6.`max_bonus`, c6.`enabled`
FROM `bg_rebate_level_config` c6
CROSS JOIN (SELECT 7 AS `level` UNION ALL SELECT 8 UNION ALL SELECT 9) lv
WHERE c6.`level` = 6;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. bg_vip_level_benefit  每级权益数值（后台可配）
--    金额单位与钱包/洗码一致（主单位，非分）；negative_rebate_pct 为百分比（1.000 = 1%）
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_vip_level_benefit` (
  `level`               TINYINT        NOT NULL                COMMENT 'VIP 等级 1–9（复用洗码等级）',
  `promotion_bonus`     DECIMAL(18,2)  NOT NULL DEFAULT 0      COMMENT '晋级礼金（升到该级一次性发放）',
  `weekly_salary`       DECIMAL(18,2)  NOT NULL DEFAULT 0      COMMENT '周俸（二期启用）',
  `monthly_salary`      DECIMAL(18,2)  NOT NULL DEFAULT 0      COMMENT '月俸（二期启用）',
  `negative_rebate_pct` DECIMAL(5,3)   NOT NULL DEFAULT 0      COMMENT '负盈利返水率 %（按周净输返还）',
  `retention_line`      DECIMAL(18,2)  NOT NULL DEFAULT 0      COMMENT '保级线（季度有效流水，二期启用）',
  `updated_at`          DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='VIP 每级权益配置（后台可调整）';

-- 预设值（对应产品方案；LV1 入门级无权益）
INSERT IGNORE INTO `bg_vip_level_benefit`
  (`level`, `promotion_bonus`, `weekly_salary`, `monthly_salary`, `negative_rebate_pct`, `retention_line`) VALUES
  (1,    0,    0,    0, 0.000,       0),
  (2,    5,    1,    5, 0.500,     500),
  (3,   15,    3,   15, 0.800,    2000),
  (4,   50,    8,   40, 1.000,    8000),
  (5,  150,   20,  100, 1.200,   25000),
  (6,  400,   50,  260, 1.500,   60000),
  (7, 1000,  130,  700, 1.800,  160000),
  (8, 2800,  350, 1800, 2.200,  400000),
  (9, 8000, 1000, 5000, 2.600, 1200000);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. bg_vip_reward_log  VIP 礼金发放记录（幂等：同一用户·类型·周期·币种唯一）
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_vip_reward_log` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       VARCHAR(32)     NOT NULL,
  `level`         TINYINT         NOT NULL                    COMMENT '发放时用户等级',
  `type`          ENUM('promotion','weekly','monthly','negative_rebate','birthday') NOT NULL COMMENT '礼金类型',
  `amount`        DECIMAL(18,2)   NOT NULL DEFAULT 0          COMMENT '发放金额',
  `currency_code` VARCHAR(32)     NOT NULL DEFAULT 'PHP',
  `period_key`    VARCHAR(32)     NOT NULL                    COMMENT '幂等周期键：晋级=L{级}，周=ISO周一日期，月=YYYY-MM',
  `status`        ENUM('pending','paid') NOT NULL DEFAULT 'pending',
  `expire_at`     DATETIME(3)     NULL                        COMMENT '领取截止（二期周俸/月俸限时用），NULL=不过期',
  `paid_at`       DATETIME(3)     NULL,
  `created_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_type_period_cur` (`user_id`, `type`, `period_key`, `currency_code`),
  KEY `idx_user_status` (`user_id`, `status`),
  KEY `idx_type_period` (`type`, `period_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='VIP 礼金发放记录（pending 待领取 / paid 已领取）';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. bg_wallet_ledger.type 追加 'vip_bonus'（幂等；基于现有 COLUMN_TYPE 追加，不重列已有枚举，防线上漂移）
-- ─────────────────────────────────────────────────────────────────────────────
SET @col_type = (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_wallet_ledger' AND COLUMN_NAME = 'type'
);
SET @need = IF(@col_type NOT LIKE '%vip_bonus%',
  CONCAT(
    'ALTER TABLE `bg_wallet_ledger` MODIFY COLUMN `type` ',
    INSERT(@col_type, LENGTH(@col_type), 0, ",'vip_bonus'"),
    ' COLLATE utf8mb4_unicode_ci NOT NULL'
  ),
  'SELECT 1'
);
PREPARE st FROM @need; EXECUTE st; DEALLOCATE PREPARE st;
