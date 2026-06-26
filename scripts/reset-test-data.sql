-- 测试环境数据清理脚本
-- 作用：清空所有业务数据，仅保留 BG-10001 用户
-- 适用：测试环境重置，不可用于生产
--
-- 清理范围：
--   存款记录、提款记录、账变记录、投注记录、流水记录、操作日志
--   三级分销佣金/GGR/提现、佣金提现审核日志、渠道代理数据
--   洗码返佣记录、转盘抽奖参与记录、提款审核日志、实名认证记录
--   除 BG-10001 外的所有用户及其关联数据
--   BG-10001 的钱包余额与实名认证数据归零
--
-- 不清理（保留后台配置）：
--   bg_team_rate_plan、bg_team_config、BG-10001 的 rate_plan_id
--   bg_rebate_config、bg_rebate_featured_game、bg_withdraw_review_config

SET FOREIGN_KEY_CHECKS = 0;

-- ── 后台操作日志 ─────────────────────────────────────────────
DELETE FROM admin_audit_log;

-- ── 三级分销：佣金、GGR、提现、钱包、归属树、日流水快照 ─────
DELETE FROM bg_team_commission;
DELETE FROM bg_team_turnover_daily;
DELETE FROM bg_team_ggr_monthly;
DELETE FROM bg_team_withdraw_review_log;
DELETE FROM bg_team_withdrawal;
DELETE FROM bg_team_wallet WHERE user_id != 'BG-10001';
UPDATE bg_team_wallet
  SET available_cents=0, frozen_cents=0, lifetime_earned_cents=0, version=version+1
  WHERE user_id='BG-10001';
DELETE FROM bg_team_node WHERE user_id != 'BG-10001';

-- ── 渠道代理：代理、绑定关系、推广渠道、GGR、佣金 ─────────────
DELETE FROM bg_agent_commission;
DELETE FROM bg_agent_ggr_monthly;
DELETE FROM bg_user_agent;
DELETE FROM bg_agent_domain;
DELETE FROM bg_agent_bot;
DELETE FROM bg_agent;

-- ── 流水记录 ──────────────────────────────────────────────────
DELETE FROM bg_turnover_allocations;
DELETE FROM bg_turnover_logs;
DELETE FROM bg_turnover_requirements;

-- ── 投注记录 ──────────────────────────────────────────────────
DELETE FROM bg_bet_order;

-- ── 洗码返佣记录（按投注流水派生，配置表 bg_rebate_config/featured_game 保留）─
DELETE FROM bg_rebate_record;

-- ── 转盘抽奖参与记录（配置、规则、奖品保留）──────────────────
DELETE FROM bg_spin_record;
DELETE FROM bg_spin_chance;

-- ── 账变记录（含活动领取：red_packet / bonus）──────────────────
DELETE FROM bg_wallet_ledger;

-- ── 存款 / 提款记录 ───────────────────────────────────────────
DELETE FROM bg_deposit_order;
DELETE FROM bg_withdraw_order;

-- ── 提款自动审核日志（审核提案规则命中记录，配置表 bg_withdraw_review_config 保留）─
DELETE FROM bg_withdraw_review_log;

-- ── 幂等键（支付回调去重缓存）────────────────────────────────
DELETE FROM bg_idempotency;

-- ── 重置钱包 ──────────────────────────────────────────────────
DELETE FROM bg_wallet WHERE user_id != 'BG-10001';
UPDATE bg_wallet SET available=0, frozen=0, version=version+1 WHERE user_id='BG-10001';

-- ── 活动参与状态（领取标记）──────────────────────────────────
-- 注：活动奖励的账变记录（red_packet/bonus）已在 bg_wallet_ledger 中一并清理
DELETE FROM bg_user_promo_state WHERE user_id != 'BG-10001';
UPDATE bg_user_promo_state
  SET trial_claimed=0, referral_claimed=0, first_dep_claimed=0,
      referral_ready=0, first_dep_ready=0, referral_milestone_met=0
  WHERE user_id='BG-10001';

-- ── 用户关联表 ────────────────────────────────────────────────
DELETE FROM bg_login_log WHERE user_id != 'BG-10001';
DELETE FROM bg_user_identity WHERE user_id != 'BG-10001';
DELETE FROM bg_user_identity WHERE user_id='BG-10001' AND provider='account';
-- 实名认证记录（含 BG-10001；影像文件与 Redis KYC 缓存由 reset-and-test.sh 同步清理）
DELETE FROM bg_kyc_doc_log;
DELETE FROM bg_kyc_submission;
DELETE FROM bg_kyc;

-- ── 删除用户（最后）───────────────────────────────────────────
DELETE FROM bg_user WHERE id != 'BG-10001';

SET FOREIGN_KEY_CHECKS = 1;

-- ── 验证 ─────────────────────────────────────────────────────
SELECT 'bg_user'           AS tbl, COUNT(*) AS remaining FROM bg_user
UNION ALL SELECT 'admin_audit_log',   COUNT(*) FROM admin_audit_log
UNION ALL SELECT 'bg_bet_order',       COUNT(*) FROM bg_bet_order
UNION ALL SELECT 'bg_team_commission', COUNT(*) FROM bg_team_commission
UNION ALL SELECT 'bg_team_withdraw_review_log', COUNT(*) FROM bg_team_withdraw_review_log
UNION ALL SELECT 'bg_agent',           COUNT(*) FROM bg_agent
UNION ALL SELECT 'bg_agent_domain',    COUNT(*) FROM bg_agent_domain
UNION ALL SELECT 'bg_agent_bot',       COUNT(*) FROM bg_agent_bot
UNION ALL SELECT 'bg_user_agent',      COUNT(*) FROM bg_user_agent
UNION ALL SELECT 'bg_spin_chance',     COUNT(*) FROM bg_spin_chance
UNION ALL SELECT 'bg_spin_record',     COUNT(*) FROM bg_spin_record
UNION ALL SELECT 'bg_wallet_ledger',   COUNT(*) FROM bg_wallet_ledger
UNION ALL SELECT 'bg_deposit_order',   COUNT(*) FROM bg_deposit_order
UNION ALL SELECT 'bg_turnover_logs',   COUNT(*) FROM bg_turnover_logs
UNION ALL SELECT 'bg_team_node',       COUNT(*) FROM bg_team_node
UNION ALL SELECT 'bg_user_identity',   COUNT(*) FROM bg_user_identity
UNION ALL SELECT 'bg_kyc',             COUNT(*) FROM bg_kyc
UNION ALL SELECT 'bg_kyc_doc_log',     COUNT(*) FROM bg_kyc_doc_log
UNION ALL SELECT 'bg_kyc_submission',  COUNT(*) FROM bg_kyc_submission
UNION ALL SELECT 'bg_rebate_record',   COUNT(*) FROM bg_rebate_record
UNION ALL SELECT 'bg_withdraw_review_log', COUNT(*) FROM bg_withdraw_review_log;
