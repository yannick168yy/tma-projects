-- 038: 佣金结算 FX 支持 + 自动结算配置
-- 统一 PHP 结算：所有币种佣金在结算时换算为 PHP 入账

SET @s = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_team_commission' AND COLUMN_NAME='fx_rate') = 0,
  'ALTER TABLE bg_team_commission ADD COLUMN fx_rate DECIMAL(12,6) NOT NULL DEFAULT 1.000000 COMMENT ''结算时使用的 1单位原始货币→PHP 汇率''',
  'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @s = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_team_commission' AND COLUMN_NAME='php_equivalent_cents') = 0,
  'ALTER TABLE bg_team_commission ADD COLUMN php_equivalent_cents BIGINT NOT NULL DEFAULT 0 COMMENT ''按结算汇率折算后的 PHP 分（正负同 commission_cents）''',
  'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @s = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_team_config' AND COLUMN_NAME='settlement_hour') = 0,
  'ALTER TABLE bg_team_config ADD COLUMN settlement_hour TINYINT NOT NULL DEFAULT 3 COMMENT ''自动结算触发小时（PHT，0-23），默认凌晨3点''',
  'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @s = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_team_config' AND COLUMN_NAME='last_auto_settlement') = 0,
  'ALTER TABLE bg_team_config ADD COLUMN last_auto_settlement VARCHAR(7) DEFAULT NULL COMMENT ''上次自动结算的期间（YYYY-MM），防重复触发''',
  'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 最低提现更新为 ₱100（10000 分）
UPDATE bg_team_config SET min_withdrawal_cents = 10000 WHERE id = 1;
