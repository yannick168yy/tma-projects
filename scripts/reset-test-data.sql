-- 测试环境数据清理脚本
-- 作用：清空所有业务数据，仅保留 BG-10001 用户
-- 适用：测试环境重置，不可用于生产
--
-- 清理范围：
--   存款记录、提款记录、账变记录、投注记录、流水记录
--   三级分销佣金/GGR/提现
--   除 BG-10001 外的所有用户及其关联数据
--   BG-10001 的钱包余额归零

SET FOREIGN_KEY_CHECKS = 0;

-- ── 三级分销：佣金、GGR、提现、钱包、归属树 ─────────────────
DELETE FROM bg_team_commission;
DELETE FROM bg_team_ggr_monthly;
DELETE FROM bg_team_withdrawal;
DELETE FROM bg_team_wallet WHERE user_id != 'BG-10001';
UPDATE bg_team_wallet
  SET available_cents=0, frozen_cents=0, lifetime_earned_cents=0, version=version+1
  WHERE user_id='BG-10001';
DELETE FROM bg_team_node WHERE user_id != 'BG-10001';

-- ── 流水记录 ──────────────────────────────────────────────────
DELETE FROM bg_turnover_allocations;
DELETE FROM bg_turnover_logs;
DELETE FROM bg_turnover_requirements;

-- ── 投注记录 ──────────────────────────────────────────────────
DELETE FROM bg_bet_order;

-- ── 账变记录 ──────────────────────────────────────────────────
DELETE FROM bg_wallet_ledger;

-- ── 存款 / 提款记录 ───────────────────────────────────────────
DELETE FROM bg_deposit_order;
DELETE FROM bg_withdraw_order;

-- ── 幂等键（支付回调去重缓存）────────────────────────────────
DELETE FROM bg_idempotency;

-- ── 重置钱包 ──────────────────────────────────────────────────
DELETE FROM bg_wallet WHERE user_id != 'BG-10001';
UPDATE bg_wallet SET available=0, frozen=0, version=version+1 WHERE user_id='BG-10001';

-- ── 活动 / 邀请 ───────────────────────────────────────────────
DELETE FROM bg_user_promo_state WHERE user_id != 'BG-10001';
UPDATE bg_user_promo_state
  SET trial_claimed=0, referral_claimed=0, first_dep_claimed=0,
      referral_ready=0, first_dep_ready=0, referral_milestone_met=0
  WHERE user_id='BG-10001';

-- ── 用户关联表 ────────────────────────────────────────────────
DELETE FROM bg_login_log WHERE user_id != 'BG-10001';
DELETE FROM bg_kyc_submission WHERE user_id != 'BG-10001';
DELETE FROM bg_user_profile WHERE user_id != 'BG-10001';

-- ── 删除用户（最后）───────────────────────────────────────────
DELETE FROM bg_user WHERE id != 'BG-10001';

SET FOREIGN_KEY_CHECKS = 1;

-- ── 验证 ─────────────────────────────────────────────────────
SELECT 'bg_user'           AS tbl, COUNT(*) AS remaining FROM bg_user
UNION ALL SELECT 'bg_bet_order',       COUNT(*) FROM bg_bet_order
UNION ALL SELECT 'bg_team_commission', COUNT(*) FROM bg_team_commission
UNION ALL SELECT 'bg_wallet_ledger',   COUNT(*) FROM bg_wallet_ledger
UNION ALL SELECT 'bg_deposit_order',   COUNT(*) FROM bg_deposit_order
UNION ALL SELECT 'bg_turnover_logs',   COUNT(*) FROM bg_turnover_logs
UNION ALL SELECT 'bg_team_node',       COUNT(*) FROM bg_team_node;
