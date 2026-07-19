-- 清理「转盘抽奖(存款侧)」历史数据，仅保留每日签到转盘
--
-- ⚠️ 手动执行脚本：切勿放进 infra/database/betogo/ 迁移目录，不随部署自动执行
-- ⚠️ 会永久删除 kind='deposit' 的档位/奖品及其中奖记录、抽奖次数，执行前请确认目标库
--
-- 用法（在服务器上，确认目标库后手动执行一次）：
--   mysql -h <host> -u <user> -p <db> < scripts/cleanup-spin-deposit.sql
--
-- 删除顺序按外键依赖：record → chance / prize → rule
-- （bg_spin_record.chance_id→chance，record.prize_id→prize，chance.rule_id→rule，prize.rule_id→rule）

-- 执行前可先预览将被删除的存款档位与奖品数量：
--   SELECT COUNT(*) FROM bg_spin_deposit_rule WHERE kind = 'deposit';
--   SELECT COUNT(*) FROM bg_spin_prize p JOIN bg_spin_deposit_rule d ON d.id = p.rule_id WHERE d.kind = 'deposit';

START TRANSACTION;

-- 1. 删除存款档中奖记录（先解开 record 对 chance/prize 的外键）
DELETE r FROM bg_spin_record r
JOIN bg_spin_chance c ON c.id = r.chance_id
JOIN bg_spin_deposit_rule d ON d.id = c.rule_id
WHERE d.kind = 'deposit';

-- 2. 删除存款档抽奖次数账本
DELETE c FROM bg_spin_chance c
JOIN bg_spin_deposit_rule d ON d.id = c.rule_id
WHERE d.kind = 'deposit';

-- 3. 删除存款档奖品
DELETE p FROM bg_spin_prize p
JOIN bg_spin_deposit_rule d ON d.id = p.rule_id
WHERE d.kind = 'deposit';

-- 4. 删除存款档位本身
DELETE FROM bg_spin_deposit_rule WHERE kind = 'deposit';

COMMIT;
