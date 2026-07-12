-- 手动执行，不自动部署。
--
-- 用途：迁移 133 把 bg_wallet_ledger.balance_after 从 bigint 改为 decimal(18,6) 后，
-- 历史行的小数部分已被取整丢失（如 241.01 记成 241）。本脚本按每个 (user_id, currency)
-- 以 created_at, id 升序累加 amount，重算 balance_after，使交易流水的"当前余额"列恢复精确。
--
-- 安全前提（执行前已核对）：45/46 钱包"累加 amount == 真实 available"，可安全重算。
-- 例外 W568TEST001（568win 无缝钱包测试号，余额不走本流水），重算后其快照与 available
-- 仍不一致——这是既有数据情况，与本次修复无关，可忽略。
--
-- 执行：
--   podman exec -i tma-mysql mysql -ubetogo -p"$PASS" betogo < scripts/backfill-ledger-balance-after.sql

UPDATE bg_wallet_ledger l
JOIN (
  SELECT id,
         SUM(amount) OVER (PARTITION BY user_id, currency ORDER BY created_at, id
                           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
  FROM bg_wallet_ledger
) c ON c.id = l.id
SET l.balance_after = c.running;
