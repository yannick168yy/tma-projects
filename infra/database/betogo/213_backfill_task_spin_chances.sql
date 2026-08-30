-- 修复任务转盘机会曾使用全局来源编号，导致同一任务周期只有首位用户成功入账的问题。
-- 新来源与 task.service.ts 保持一致：tsk: + SHA256(source|user|currency) 前 40 位。

SET @task_spin_rule_id = (
  SELECT id
  FROM bg_spin_deposit_rule
  WHERE kind = 'checkin' AND enabled = 1
  ORDER BY id
  LIMIT 1
);

INSERT IGNORE INTO bg_spin_chance
  (user_id, source_order_id, rule_id, deposit_amount_php, chances_total)
SELECT
  claim.user_id,
  CONCAT('tsk:', LEFT(SHA2(CONCAT(
    'task:', claim.task_id, ':', claim.period_key, '|', claim.user_id, '|', claim.currency
  ), 256), 40)),
  @task_spin_rule_id,
  0,
  claim.reward_spin
FROM bg_task_claim claim
WHERE @task_spin_rule_id IS NOT NULL
  AND claim.reward_type = 'spin'
  AND claim.reward_spin > 0
  AND NOT EXISTS (
    SELECT 1
    FROM bg_spin_chance existing
    WHERE existing.user_id = claim.user_id
      AND existing.source_order_id IN (
        CONCAT('task:', claim.task_id, ':', claim.period_key),
        CONCAT('tsk:', LEFT(SHA2(CONCAT(
          'task:', claim.task_id, ':', claim.period_key, '|', claim.user_id, '|', claim.currency
        ), 256), 40))
      )
  );
