-- 191: bg_bet_order 补 created_at 索引
-- 起因：158 给 bg_login_log / bg_wallet_ledger / bg_deposit_order / bg_withdraw_order /
--   bg_568win_wallet_txn 都补了 idx_created，唯独漏了注单表。
--   生产 EXPLAIN 实测：按纯时间窗聚合（每日返水 rebate.service.ts、亏损返水、后台按日期筛注单）
--   全是 type=ALL 全表扫（possible_keys=NULL），现有索引 idx_user_created / idx_bet_user_round
--   都以 user_id 打头，不带 user_id 的时间窗查询命中不了。
-- 紧迫性：生产注单日增约 10 万行，全表扫成本随天数线性上涨——
--   实测当前 60 万行 0.23s，按此增速 3 个月后（约 3000 万行）同一条查询要 10s 以上。
SET NAMES utf8mb4;

-- 显式声明在线 DDL：写不上就报错，绝不退化成锁表重建（注单表回调写入不能停）
CREATE INDEX `idx_created` ON `bg_bet_order` (`created_at`) ALGORITHM=INPLACE LOCK=NONE;
