-- 143: 复充限时(redep) + 负盈利返水(loss_rebate) 金额门槛按币种（每币种独立账号）
--
-- redep 改为多币种(用户拍板)：min_deposit/bonus_amount 按币种独立配置，发奖入对应币种钱包。
-- loss_rebate：聚合/发放本就按币种，仅 min_deposit 门槛原为全局单值，改按币种。
-- 金额型 config_key 用币种小写后缀（min_deposit_usdt 等）；PHP 沿用原 key 向后兼容。
-- USDT/USDC 初始值 = PHP ÷58 起点(后台可再调)。window/cooldown/turnover/rate% 币种无关不加后缀。

SET NAMES utf8mb4;

-- redep 按币种门槛/奖励（PHP 500/75 → USDT/USDC ≈8.62/1.29）
INSERT IGNORE INTO `bg_promo_config` (`promo_id`, `config_key`, `config_value`) VALUES
  ('redep', 'min_deposit_usdt',  '8.62'),
  ('redep', 'bonus_amount_usdt', '1.29'),
  ('redep', 'min_deposit_usdc',  '8.62'),
  ('redep', 'bonus_amount_usdc', '1.29');

-- loss_rebate 按币种门槛（PHP 50 → USDT/USDC ≈0.86）
INSERT IGNORE INTO `bg_promo_config` (`promo_id`, `config_key`, `config_value`) VALUES
  ('loss_rebate', 'min_deposit_usdt', '0.86'),
  ('loss_rebate', 'min_deposit_usdc', '0.86');

-- bg_redep_offer 加 currency 列：每个复充窗口绑定一个币种（快照该币种门槛/奖励）
SET @has = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_redep_offer' AND COLUMN_NAME = 'currency');
SET @sql = IF(@has = 0,
  "ALTER TABLE `bg_redep_offer`
     ADD COLUMN `currency` VARCHAR(16) NOT NULL DEFAULT 'PHP' COMMENT '窗口币种（达标/发奖均按此币种）' AFTER `user_id`",
  'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
