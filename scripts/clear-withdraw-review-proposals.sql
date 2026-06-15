-- 手动执行：清空取款审核提案数据（不删 bg_withdraw_review_config 规则配置）
-- 用法（测试库）:
--   podman exec -i tma-mysql mysql -utma -ptma_dev betogo < scripts/clear-withdraw-review-proposals.sql

SET FOREIGN_KEY_CHECKS = 0;

-- pending 提案退款（提交时已扣款）
UPDATE bg_wallet w
INNER JOIN bg_withdraw_order o
  ON o.user_id = w.user_id AND o.currency = w.currency AND o.status = 'pending'
SET w.available = w.available + o.amount,
    w.version = w.version + 1;

DELETE FROM bg_withdraw_review_log;
DELETE FROM bg_withdraw_order;

SET FOREIGN_KEY_CHECKS = 1;

SELECT 'bg_withdraw_order' AS tbl, COUNT(*) AS remaining FROM bg_withdraw_order
UNION ALL SELECT 'bg_withdraw_review_log', COUNT(*) FROM bg_withdraw_review_log
UNION ALL SELECT 'pending_manual', COUNT(*) FROM bg_withdraw_order WHERE status = 'pending' AND review_verdict = 'manual';
