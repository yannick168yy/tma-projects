-- 066: 洗码分级系统（LV1–LV6）
--
-- 变更列表：
--   新建 bg_rebate_level_config      — 每个等级 × 游戏大类的洗码比例（后台配置，二维矩阵）
--   新建 bg_rebate_level_threshold   — 每个等级所需的累计有效流水阈值（后台配置）
--
-- 说明：
--   用户等级 = 满足 min_turnover <= 总有效流水（SUM bg_turnover_logs.effective_amount）的最高等级。
--   洗码结算时按用户当前等级取对应大类费率；精选游戏 elite/pro 档位仍独立覆盖（见 rebate.service）。
--   旧表 bg_rebate_config 保留为兼容/默认来源，此处按其现值播种 LV1–6 初始矩阵，后台再分级调整。

SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. bg_rebate_level_config  等级 × 大类 洗码比例矩阵
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_rebate_level_config` (
  `level`         TINYINT       NOT NULL                    COMMENT '等级 1–6',
  `game_category` VARCHAR(32)   NOT NULL                    COMMENT '游戏大类（与 bg_turnover_logs.sort_category 对应）',
  `rate_pct`      DECIMAL(5,3)  NOT NULL DEFAULT 0.800      COMMENT '洗码比例 %（1.000 = 1%）',
  `enabled`       TINYINT(1)    NOT NULL DEFAULT 1           COMMENT '该等级该大类是否参与洗码',
  `updated_at`    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`level`, `game_category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='洗码分级费率配置（LV1–6 × 游戏大类）';

-- 按现有 bg_rebate_config 各大类费率，复制到全部 6 个等级作为初始矩阵（后台再分级调整）
INSERT IGNORE INTO `bg_rebate_level_config` (`level`, `game_category`, `rate_pct`, `enabled`)
SELECT lv.`level`, rc.`game_category`, rc.`rate_pct`, rc.`enabled`
FROM `bg_rebate_config` rc
CROSS JOIN (
  SELECT 1 AS `level` UNION ALL SELECT 2 UNION ALL SELECT 3
  UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6
) lv;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. bg_rebate_level_threshold  等级所需累计有效流水阈值
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_rebate_level_threshold` (
  `level`        TINYINT        NOT NULL                   COMMENT '等级 1–6',
  `min_turnover` DECIMAL(18,2)  NOT NULL DEFAULT 0         COMMENT '达到该等级所需的累计有效流水',
  `updated_at`   DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='洗码等级流水阈值（后台配置；LV1 固定 0）';

-- 占位阈值，后台按业务调整（LV1=0 保证所有用户至少为 LV1）
INSERT IGNORE INTO `bg_rebate_level_threshold` (`level`, `min_turnover`) VALUES
  (1, 0),
  (2, 10000),
  (3, 50000),
  (4, 200000),
  (5, 1000000),
  (6, 5000000);
