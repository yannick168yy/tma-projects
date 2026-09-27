-- 修复签到转盘后台「保存后回显和编辑内容不一致」遗留的脏数据
--
-- ⚠️ 手动执行脚本：切勿放进 infra/database/betogo/ 迁移目录，不随部署自动执行
--
-- 背景：历史迁移（144/202/230）复制奖池时连停用奖品一起复制，旧逻辑保存时也只停用不挪位，
-- 导致同一档位同一币种超过 8 个奖品、同一 sort_order 格子里有多行。后台按 sort_order 取前 8 个，
-- 就会把停用旧奖品混进来。新代码保存时会把停用奖品的 sort_order 挪到 100000 之后，本脚本对存量数据做同样处理。
--
-- 规则：每个 (档位, 币种, 格子 sort_order) 只保留一行 —— 优先启用的，其次 id 最大（最新）的；
-- 其余行 enabled=0 且 sort_order += 100000。不删任何行（中奖记录外键引用奖品）。
--
-- 用法：先单独跑下面的「预览」，确认第 2 条里 enabled=1 的行（会被停用、影响客户端奖池）是否符合预期，再执行整个文件：
--   mysql -uroot -p <db> < scripts/fix-spin-prize-retired-sort.sql

DROP TEMPORARY TABLE IF EXISTS tmp_spin_retire;
CREATE TEMPORARY TABLE tmp_spin_retire AS
SELECT id FROM (
  SELECT p.id,
         ROW_NUMBER() OVER (PARTITION BY p.rule_id, p.currency, p.sort_order ORDER BY p.enabled DESC, p.id DESC) AS rn
  FROM bg_spin_prize p
  JOIN bg_spin_deposit_rule r ON r.id = p.rule_id AND r.kind = 'checkin'
  WHERE p.sort_order < 100000
) t
WHERE rn > 1;

-- 预览 1：各档位各币种奖品数（total > 8 即受影响）
SELECT r.checkin_tier, p.currency, COUNT(*) AS total, SUM(p.enabled) AS enabled_cnt,
       SUM(p.sort_order < 100000) AS in_slots
FROM bg_spin_prize p JOIN bg_spin_deposit_rule r ON r.id = p.rule_id AND r.kind = 'checkin'
GROUP BY r.checkin_tier, p.currency ORDER BY r.checkin_tier, p.currency;

-- 预览 2：将被挪出格子的行
SELECT r.checkin_tier, p.currency, p.id, p.sort_order, p.enabled, p.name, p.amount_php
FROM bg_spin_prize p
JOIN tmp_spin_retire t ON t.id = p.id
JOIN bg_spin_deposit_rule r ON r.id = p.rule_id
ORDER BY r.checkin_tier, p.currency, p.sort_order, p.id;

START TRANSACTION;
UPDATE bg_spin_prize p
JOIN tmp_spin_retire t ON t.id = p.id
SET p.enabled = 0, p.sort_order = p.sort_order + 100000;
COMMIT;

DROP TEMPORARY TABLE tmp_spin_retire;
