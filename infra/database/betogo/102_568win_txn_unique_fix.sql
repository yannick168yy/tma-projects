-- 102: 568Win 钱包交易唯一键修复
-- transaction_id 允许 NULL 导致 uk_transfer_txn 对 NULL 行不生效，
-- 重复 Deduct 只能靠 SERIALIZABLE 间隙锁防御。改为 NOT NULL DEFAULT ''
-- 让数据库唯一约束成为幂等的最终防线。
SET NAMES utf8mb4;

-- 历史上并发缺陷可能产生的重复行（同 transfer_code 且 transaction_id 均为 NULL）：
-- 保留最早一条，其余打上 dup: 标记以便审计，不删除数据
UPDATE bg_568win_wallet_txn t1
JOIN (
  SELECT transfer_code, MIN(id) AS keep_id
  FROM bg_568win_wallet_txn
  WHERE transaction_id IS NULL
  GROUP BY transfer_code
  HAVING COUNT(*) > 1
) d ON t1.transfer_code = d.transfer_code AND t1.id <> d.keep_id AND t1.transaction_id IS NULL
SET t1.transaction_id = CONCAT('dup:', t1.id);

UPDATE bg_568win_wallet_txn SET transaction_id = '' WHERE transaction_id IS NULL;

ALTER TABLE bg_568win_wallet_txn
  MODIFY transaction_id VARCHAR(128) NOT NULL DEFAULT '' COMMENT '568Win TransactionId，无则为空串';
