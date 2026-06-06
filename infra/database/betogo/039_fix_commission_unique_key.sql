-- 039: 修复 bg_team_commission 唯一键，含 currency + level，支持多币种分层佣金
-- 旧唯一键 uk_beneficiary_from_period 不含 currency，导致同用户多币种只记第一条
-- 清空后重建，适合测试环境（生产需先备份）

-- 删除旧唯一键
ALTER TABLE bg_team_commission DROP INDEX uk_beneficiary_from_period;

-- 建新唯一键（含 currency 和 level，一个下线在一个月可以有多币种 × 多层的佣金记录）
CREATE UNIQUE INDEX uk_commission_full
  ON bg_team_commission (beneficiary_id, from_user_id, period, currency, level);
