-- 141: 多币种独立等级账本（单账号多币种·每币种当独立账号）
--
-- 背景：USDT/USDC 钱包名义金额与 PHP 不可直接相加（1 USDT ≈ 58 PHP）。原等级体系把
--   跨币种流水 1:1 裸加定一个全局等级/封顶/阈值，导致稳定币用户等级/洗码封顶严重错算。
-- 方案（用户拍板）：不做汇率归一，把每个币种当成一个独立账号——同一 user_id 下 PHP/USDT/USDC
--   各自独立的 VIP 等级、洗码累计、封顶、阈值、权益，互不相加互不换算（与 bg_firstdep_tiers、
--   loss_rebate 的 GROUP BY currency_code、bg_wallet 每币种一行 完全一致）。
--
-- 变更：给 4 张等级/权益/状态表加 currency 维度并重建主键，seed USDT/USDC 一套独立数值。
--   - bg_rebate_level_threshold  (level)                → (level, currency)
--   - bg_rebate_level_config      (level, game_category) → (level, game_category, currency)
--   - bg_vip_level_benefit        (level)                → (level, currency)
--   - bg_user_vip_state           (user_id)              → (user_id, currency)
--
-- 幂等：全部 DDL 走 information_schema 守卫（防线上表结构漂移 + 重跑安全）；seed 用 INSERT IGNORE。
-- USDT/USDC 初始值 = PHP 值按 ≈58 汇率折算的起点（百分比/次数类币种无关直接复制），后台可再调。

SET NAMES utf8mb4;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. bg_rebate_level_threshold: 加 currency + 重建 PK (level, currency)
-- ─────────────────────────────────────────────────────────────────────────────
SET @has = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_rebate_level_threshold' AND COLUMN_NAME = 'currency');
SET @sql = IF(@has = 0,
  "ALTER TABLE `bg_rebate_level_threshold`
     ADD COLUMN `currency` VARCHAR(16) NOT NULL DEFAULT 'PHP' COMMENT '币种（每币种一套阈值）' AFTER `level`",
  'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @pkok = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_rebate_level_threshold'
    AND INDEX_NAME = 'PRIMARY' AND COLUMN_NAME = 'currency');
SET @sql = IF(@pkok = 0,
  "ALTER TABLE `bg_rebate_level_threshold` DROP PRIMARY KEY, ADD PRIMARY KEY (`level`, `currency`)",
  'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

-- seed USDT/USDC（阈值取整；LV1 固定 0）
INSERT IGNORE INTO `bg_rebate_level_threshold` (`level`, `currency`, `min_turnover`)
SELECT `level`, 'USDT', ROUND(`min_turnover` / 58, 0) FROM `bg_rebate_level_threshold` WHERE `currency` = 'PHP';
INSERT IGNORE INTO `bg_rebate_level_threshold` (`level`, `currency`, `min_turnover`)
SELECT `level`, 'USDC', ROUND(`min_turnover` / 58, 0) FROM `bg_rebate_level_threshold` WHERE `currency` = 'PHP';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. bg_rebate_level_config: 加 currency + 重建 PK (level, game_category, currency)
--    rate_pct 是百分比（币种无关）直接复制；max_bonus 是绝对封顶额按 ≈58 折算
-- ─────────────────────────────────────────────────────────────────────────────
SET @has = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_rebate_level_config' AND COLUMN_NAME = 'currency');
SET @sql = IF(@has = 0,
  "ALTER TABLE `bg_rebate_level_config`
     ADD COLUMN `currency` VARCHAR(16) NOT NULL DEFAULT 'PHP' COMMENT '币种（每币种一套费率/封顶）' AFTER `game_category`",
  'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @pkok = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_rebate_level_config'
    AND INDEX_NAME = 'PRIMARY' AND COLUMN_NAME = 'currency');
SET @sql = IF(@pkok = 0,
  "ALTER TABLE `bg_rebate_level_config` DROP PRIMARY KEY, ADD PRIMARY KEY (`level`, `game_category`, `currency`)",
  'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

INSERT IGNORE INTO `bg_rebate_level_config` (`level`, `game_category`, `currency`, `rate_pct`, `max_bonus`, `enabled`)
SELECT `level`, `game_category`, 'USDT', `rate_pct`, ROUND(`max_bonus` / 58, 2), `enabled`
FROM `bg_rebate_level_config` WHERE `currency` = 'PHP';
INSERT IGNORE INTO `bg_rebate_level_config` (`level`, `game_category`, `currency`, `rate_pct`, `max_bonus`, `enabled`)
SELECT `level`, `game_category`, 'USDC', `rate_pct`, ROUND(`max_bonus` / 58, 2), `enabled`
FROM `bg_rebate_level_config` WHERE `currency` = 'PHP';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. bg_vip_level_benefit: 加 currency + 重建 PK (level, currency)
--    金额类（promotion/weekly/monthly/birthday/retention_line/withdraw_daily_limit）按 ≈58 折算
--    百分比 negative_rebate_pct、次数 withdraw_daily_count 币种无关直接复制
-- ─────────────────────────────────────────────────────────────────────────────
SET @has = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_vip_level_benefit' AND COLUMN_NAME = 'currency');
SET @sql = IF(@has = 0,
  "ALTER TABLE `bg_vip_level_benefit`
     ADD COLUMN `currency` VARCHAR(16) NOT NULL DEFAULT 'PHP' COMMENT '币种（每币种一套权益数值）' AFTER `level`",
  'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @pkok = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_vip_level_benefit'
    AND INDEX_NAME = 'PRIMARY' AND COLUMN_NAME = 'currency');
SET @sql = IF(@pkok = 0,
  "ALTER TABLE `bg_vip_level_benefit` DROP PRIMARY KEY, ADD PRIMARY KEY (`level`, `currency`)",
  'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

INSERT IGNORE INTO `bg_vip_level_benefit`
  (`level`, `currency`, `promotion_bonus`, `weekly_salary`, `monthly_salary`, `birthday_bonus`,
   `negative_rebate_pct`, `retention_line`, `withdraw_daily_limit`, `withdraw_daily_count`)
SELECT `level`, 'USDT',
   ROUND(`promotion_bonus` / 58, 2), ROUND(`weekly_salary` / 58, 2), ROUND(`monthly_salary` / 58, 2), ROUND(`birthday_bonus` / 58, 2),
   `negative_rebate_pct`, ROUND(`retention_line` / 58, 0), ROUND(`withdraw_daily_limit` / 58, 2), `withdraw_daily_count`
FROM `bg_vip_level_benefit` WHERE `currency` = 'PHP';
INSERT IGNORE INTO `bg_vip_level_benefit`
  (`level`, `currency`, `promotion_bonus`, `weekly_salary`, `monthly_salary`, `birthday_bonus`,
   `negative_rebate_pct`, `retention_line`, `withdraw_daily_limit`, `withdraw_daily_count`)
SELECT `level`, 'USDC',
   ROUND(`promotion_bonus` / 58, 2), ROUND(`weekly_salary` / 58, 2), ROUND(`monthly_salary` / 58, 2), ROUND(`birthday_bonus` / 58, 2),
   `negative_rebate_pct`, ROUND(`retention_line` / 58, 0), ROUND(`withdraw_daily_limit` / 58, 2), `withdraw_daily_count`
FROM `bg_vip_level_benefit` WHERE `currency` = 'PHP';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. bg_user_vip_state: 加 currency + 重建 PK (user_id, currency)
--    存量行默认成为 PHP 账；USDT/USDC 状态行在用户产生该币种流水时按需建行（服务层）
--    task_growth 写入路径 INSERT (user_id, task_growth) 在 currency DEFAULT 'PHP' 下自动落 PHP 行（任务币种化留待后续）
-- ─────────────────────────────────────────────────────────────────────────────
SET @has = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_user_vip_state' AND COLUMN_NAME = 'currency');
SET @sql = IF(@has = 0,
  "ALTER TABLE `bg_user_vip_state`
     ADD COLUMN `currency` VARCHAR(16) NOT NULL DEFAULT 'PHP' COMMENT '币种（每币种一套等级状态）' AFTER `user_id`",
  'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

SET @pkok = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_user_vip_state'
    AND INDEX_NAME = 'PRIMARY' AND COLUMN_NAME = 'currency');
SET @sql = IF(@pkok = 0,
  "ALTER TABLE `bg_user_vip_state` DROP PRIMARY KEY, ADD PRIMARY KEY (`user_id`, `currency`)",
  'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
