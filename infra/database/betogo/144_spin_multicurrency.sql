-- 144: 转盘奖池按币种独立（每币种一套奖金，用户拍板）
--
-- 每个签到档(rule)原只有 PHP 一套奖品；改为每币种(PHP/USDT/USDC)各一套。
-- 抽奖按用户 activeCurrency 取该币种奖池、派奖入对应币种钱包、打码按该币种。
-- amount_php 列沿用（现语义=该奖品币种的原生金额，避免重命名大改）。
-- USDT/USDC 初始 = PHP 奖金 ÷58 起点(后台可再调)；name 重生成为该币种展示串。
-- 幂等：列加 information_schema 守卫；seed 走 schema_migrations 只跑一次（仿 069/072 直接 INSERT SELECT）。

SET NAMES utf8mb4;

-- 1. bg_spin_prize 加 currency
SET @has = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_spin_prize' AND COLUMN_NAME = 'currency');
SET @sql = IF(@has = 0,
  "ALTER TABLE `bg_spin_prize` ADD COLUMN `currency` VARCHAR(16) NOT NULL DEFAULT 'PHP' COMMENT '奖品币种（每币种一套奖池）' AFTER `rule_id`",
  'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

-- 2. bg_spin_record 加 currency（派奖记录留痕原币种）
SET @has = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_spin_record' AND COLUMN_NAME = 'currency');
SET @sql = IF(@has = 0,
  "ALTER TABLE `bg_spin_record` ADD COLUMN `currency` VARCHAR(16) NOT NULL DEFAULT 'PHP' COMMENT '派奖币种' AFTER `amount_php`",
  'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;

-- 3. seed USDT/USDC 奖池：复制 PHP 奖品，金额 ÷58，name 重生成（仅首次迁移执行一次）
INSERT INTO `bg_spin_prize` (`rule_id`, `currency`, `name`, `image_key`, `amount_php`, `weight`, `turnover_x`, `enabled`, `sort_order`)
SELECT `rule_id`, 'USDT', CONCAT(ROUND(`amount_php` / 58, 2), ' USDT'), `image_key`, ROUND(`amount_php` / 58, 2), `weight`, `turnover_x`, `enabled`, `sort_order`
FROM `bg_spin_prize` WHERE `currency` = 'PHP';

INSERT INTO `bg_spin_prize` (`rule_id`, `currency`, `name`, `image_key`, `amount_php`, `weight`, `turnover_x`, `enabled`, `sort_order`)
SELECT `rule_id`, 'USDC', CONCAT(ROUND(`amount_php` / 58, 2), ' USDC'), `image_key`, ROUND(`amount_php` / 58, 2), `weight`, `turnover_x`, `enabled`, `sort_order`
FROM `bg_spin_prize` WHERE `currency` = 'PHP';
