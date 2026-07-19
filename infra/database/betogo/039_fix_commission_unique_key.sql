-- 039: 修复 bg_team_commission 唯一键，含 currency + level，支持多币种分层佣金
-- 旧唯一键 uk_beneficiary_from_period 不含 currency，导致同用户多币种只记第一条

-- 删除旧唯一键（不存在时跳过）
SET @s = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_team_commission' AND INDEX_NAME='uk_beneficiary_from_period') > 0,
  'ALTER TABLE bg_team_commission DROP INDEX uk_beneficiary_from_period',
  'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

-- 建新唯一键（含 currency 和 level，一个下线在一个月可以有多币种 × 多层的佣金记录）
SET @s = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_team_commission' AND INDEX_NAME='uk_commission_full') = 0,
  'CREATE UNIQUE INDEX uk_commission_full ON bg_team_commission (beneficiary_id, from_user_id, period, currency, level)',
  'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;
