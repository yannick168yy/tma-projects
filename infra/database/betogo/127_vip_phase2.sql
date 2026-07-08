-- 127: VIP 成长体系（二期）
--
-- 变更列表：
--   新建 bg_user_vip_state       — 用户 VIP 等级状态（current_level 可降级，awarded_level 为历史最高）
--   bg_vip_level_benefit 扩列    — birthday_bonus / withdraw_daily_limit / withdraw_daily_count（后台可配）
--   bg_user 增列 birthday        — 生日（一次性设置，用于生日礼金；information_schema 幂等守卫）
--
-- 说明：
--   二期引入「硬降级」保级模型：等级不再只由终身累计流水决定。
--   current_level = 权威展示/计权等级（周俸/月俸/负盈利返水率/洗码率均按它取）；
--   awarded_level = 历史最高（累计流水爬升写入，单调不降，用于降级后回升的上界）。
--   无状态行的老用户，各处按等级计算时 COALESCE 回落到阈值计算，保证不受影响。

SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. bg_user_vip_state  用户 VIP 等级状态
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_user_vip_state` (
  `user_id`                VARCHAR(32)   NOT NULL,
  `current_level`          TINYINT       NOT NULL DEFAULT 1   COMMENT '权威等级（可因保级失败下降）',
  `awarded_level`          TINYINT       NOT NULL DEFAULT 1   COMMENT '历史最高等级（累计流水爬升，单调不降）',
  `quarter_key`            VARCHAR(16)   NOT NULL DEFAULT ''  COMMENT '当前保级考核季度，如 2026-Q3',
  `quarter_start_turnover` DECIMAL(18,2) NOT NULL DEFAULT 0   COMMENT '本季度起点的累计有效流水快照',
  `updated_at`             DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  KEY `idx_quarter` (`quarter_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='用户 VIP 等级状态（支持保级降级）';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. bg_vip_level_benefit 扩列：生日礼金 + 专属提现额度/次数
-- ─────────────────────────────────────────────────────────────────────────────
SET @has_bday = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_vip_level_benefit' AND COLUMN_NAME = 'birthday_bonus');
SET @sql = IF(@has_bday = 0,
  "ALTER TABLE `bg_vip_level_benefit`
     ADD COLUMN `birthday_bonus` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '生日礼金' AFTER `monthly_salary`,
     ADD COLUMN `withdraw_daily_limit` DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '专属每日提现额度上限（0=不额外提升）',
     ADD COLUMN `withdraw_daily_count` INT NOT NULL DEFAULT 0 COMMENT '专属每日提现次数上限（0=不额外提升）'",
  'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

-- 生日礼金预设（LV1 入门无；随等级递增）
UPDATE `bg_vip_level_benefit` SET `birthday_bonus` = CASE `level`
  WHEN 1 THEN 0 WHEN 2 THEN 5 WHEN 3 THEN 10 WHEN 4 THEN 20 WHEN 5 THEN 50
  WHEN 6 THEN 100 WHEN 7 THEN 200 WHEN 8 THEN 350 WHEN 9 THEN 500 ELSE `birthday_bonus` END
WHERE `birthday_bonus` = 0 AND `level` BETWEEN 1 AND 9;

-- 专属提现次数预设（仅高等级提升；语义=只抬高不压低，0=沿用平台默认）
UPDATE `bg_vip_level_benefit` SET `withdraw_daily_count` = CASE `level`
  WHEN 5 THEN 5 WHEN 6 THEN 8 WHEN 7 THEN 12 WHEN 8 THEN 20 WHEN 9 THEN 30 ELSE `withdraw_daily_count` END
WHERE `withdraw_daily_count` = 0 AND `level` BETWEEN 5 AND 9;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. bg_user 增列 birthday（幂等守卫，防线上漂移已存在）
-- ─────────────────────────────────────────────────────────────────────────────
SET @has_col = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_user' AND COLUMN_NAME = 'birthday');
SET @sql2 = IF(@has_col = 0,
  "ALTER TABLE `bg_user` ADD COLUMN `birthday` DATE NULL COMMENT '生日（一次性设置，用于 VIP 生日礼金）'",
  'SELECT 1');
PREPARE st2 FROM @sql2; EXECUTE st2; DEALLOCATE PREPARE st2;
