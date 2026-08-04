-- 198: 后台报表筛选与排序索引
-- 支撑财务账变金额排序、投注记录局号筛选、按局报表分页后的游戏信息映射。
SET NAMES utf8mb4;

CREATE INDEX `idx_amount_created` ON `bg_wallet_ledger` (`amount`, `created_at`) ALGORITHM=INPLACE LOCK=NONE;

CREATE INDEX `idx_round_created` ON `bg_bet_order` (`round_id`, `created_at`) ALGORITHM=INPLACE LOCK=NONE;
CREATE INDEX `idx_provider_txn_created` ON `bg_bet_order` (`provider_txn_id`, `created_at`) ALGORITHM=INPLACE LOCK=NONE;

CREATE INDEX `idx_user_provider_round_id` ON `bg_568win_wallet_txn` (`user_id`, `provider_id`, `round_id`, `id`) ALGORITHM=INPLACE LOCK=NONE;
CREATE INDEX `idx_user_provider_id` ON `bg_568win_wallet_txn` (`user_id`, `provider_id`, `id`) ALGORITHM=INPLACE LOCK=NONE;
