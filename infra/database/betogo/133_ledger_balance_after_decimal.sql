-- 133: 修复钱包流水快照余额被取整
--
-- bg_wallet_ledger.balance_after 历史为 bigint，写入时把 bg_wallet.available（decimal(18,6)）
-- 的小数部分四舍五入截掉（如 241.01 记成 241、277.77 记成 278）。
-- 导致交易流水里「金额 +0.24 但当前余额列不变」，与真实钱包余额对不上。
-- 真实余额 bg_wallet.available 一直是准的，仅此快照列失真。
-- 这里把该列对齐为 decimal(18,6)，此后写入不再取整。
-- 注意：历史行已丢失的小数无法从本列恢复（如需可另按 amount 逐户重算，见运维脚本）。

SET NAMES utf8mb4;

SET @is_bigint = (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_wallet_ledger'
    AND COLUMN_NAME = 'balance_after' AND DATA_TYPE <> 'decimal');
SET @sql_bal = IF(@is_bigint > 0,
  "ALTER TABLE `bg_wallet_ledger` MODIFY COLUMN `balance_after` DECIMAL(18,6) NOT NULL COMMENT '本次记账后可用余额快照'",
  'SELECT 1');
PREPARE st_bal FROM @sql_bal; EXECUTE st_bal; DEALLOCATE PREPARE st_bal;
