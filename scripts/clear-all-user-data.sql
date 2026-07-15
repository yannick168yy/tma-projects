-- 测试环境用户数据清理脚本
-- 作用：清空全部用户及其派生数据，保留所有设置数据和游戏商数据
-- 适用：测试环境手动执行，不可用于生产
--
-- 清理范围：
--   用户、登录、会话、钱包、账变、充提、投注、KYC、客服会话
--   三级奖励、渠道代理用户归因、佣金/提现、洗码返佣、转盘参与、签到、任务领取
--   VIP 用户状态/奖励、风控用户画像/命中日志、游戏启动历史、568Win 玩家映射/交易/报表注单
--
-- 保留范围：
--   admin_accounts、bg_admin_settings、支付渠道/路由、活动配置、VIP 权益配置、任务配置
--   风控策略/黑名单、提现审核规则、团队费率/套餐、洗码/VIP 等级配置
--   bg_568win_agent、bg_568win_provider、bg_568win_game*、bg_virtual_game_config 等游戏商/游戏目录数据

SET FOREIGN_KEY_CHECKS = 0;

DROP PROCEDURE IF EXISTS delete_table_if_exists;
DROP PROCEDURE IF EXISTS exec_if_table_exists;

DELIMITER //
CREATE PROCEDURE delete_table_if_exists(IN p_table_name VARCHAR(64))
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table_name
  ) THEN
    SET @sql = CONCAT('DELETE FROM `', REPLACE(p_table_name, '`', '``'), '`');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//

CREATE PROCEDURE exec_if_table_exists(IN p_table_name VARCHAR(64), IN p_sql TEXT)
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table_name
  ) THEN
    SET @sql = p_sql;
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//
DELIMITER ;

-- ── 后台/客服日志 ─────────────────────────────────────────────
CALL delete_table_if_exists('admin_audit_log');
CALL delete_table_if_exists('cs_message');
CALL delete_table_if_exists('cs_conversation');

-- ── 任务 / 活动 / VIP 用户台账 ───────────────────────────────
CALL delete_table_if_exists('bg_task_manual_review');
CALL delete_table_if_exists('bg_task_social_claim');
CALL delete_table_if_exists('bg_task_claim');
CALL delete_table_if_exists('bg_vip_reward_log');
CALL delete_table_if_exists('bg_user_vip_state');
CALL delete_table_if_exists('bg_redep_offer');
CALL delete_table_if_exists('bg_app_download_claim');
CALL delete_table_if_exists('bg_channel_deposit_bonus_claim');
CALL delete_table_if_exists('bg_checkin_log');
CALL delete_table_if_exists('bg_promo_claim');
CALL delete_table_if_exists('bg_referral_record');
CALL delete_table_if_exists('bg_user_promo_state');

-- ── 风控用户数据（策略/黑名单保留）────────────────────────────
CALL delete_table_if_exists('bg_risk_hit_log');
CALL delete_table_if_exists('bg_user_risk_signal');
CALL delete_table_if_exists('bg_user_tag');
CALL delete_table_if_exists('bg_user_segment');

-- ── 568Win 用户侧数据（Agent、Provider、Game、Override 保留）──
CALL delete_table_if_exists('bg_568win_wallet_txn');
CALL delete_table_if_exists('bg_568win_report_bet');
CALL delete_table_if_exists('bg_aggregator_player');

-- ── 游戏与投注用户数据 ───────────────────────────────────────
CALL delete_table_if_exists('bg_game_launch');
CALL delete_table_if_exists('bg_game_session');
CALL delete_table_if_exists('bg_bet_order');

-- ── 代理 / 三级奖励用户数据（配置与费率保留）──────────────────
CALL delete_table_if_exists('bg_agent_commission');
CALL delete_table_if_exists('bg_agent_ggr_monthly');
CALL delete_table_if_exists('bg_user_agent');
CALL exec_if_table_exists('bg_agent_domain', 'UPDATE `bg_agent_domain` SET `agent_id` = NULL');
CALL exec_if_table_exists('bg_agent_bot', 'UPDATE `bg_agent_bot` SET `agent_id` = NULL');
CALL delete_table_if_exists('bg_agent_channel');
CALL delete_table_if_exists('bg_agent');
CALL delete_table_if_exists('bg_team_withdraw_review_log');
CALL delete_table_if_exists('bg_team_withdrawal');
CALL delete_table_if_exists('bg_team_commission');
CALL delete_table_if_exists('bg_team_ggr_monthly');
CALL delete_table_if_exists('bg_team_turnover_daily');
CALL delete_table_if_exists('bg_team_wallet');
CALL delete_table_if_exists('bg_team_node');

-- ── 流水、返佣、转盘、充提、钱包 ─────────────────────────────
CALL delete_table_if_exists('bg_turnover_allocations');
CALL delete_table_if_exists('bg_turnover_logs');
CALL delete_table_if_exists('bg_turnover_requirements');
CALL delete_table_if_exists('bg_rebate_record');
CALL delete_table_if_exists('bg_spin_record');
CALL delete_table_if_exists('bg_spin_chance');
CALL delete_table_if_exists('bg_withdraw_review_log');
CALL delete_table_if_exists('bg_withdraw_order');
CALL delete_table_if_exists('bg_deposit_order');
CALL delete_table_if_exists('bg_matrix_withdraw_order');
CALL delete_table_if_exists('bg_matrix_deposit_order');
CALL delete_table_if_exists('bg_matrix_deposit_address');
CALL delete_table_if_exists('bg_order_withdraw');
CALL delete_table_if_exists('bg_order_deposit');
CALL delete_table_if_exists('bg_payment_order');
CALL delete_table_if_exists('bg_wallet_ledger');
CALL delete_table_if_exists('bg_wallet');
CALL delete_table_if_exists('bg_idempotency');

-- ── KYC / 登录 / 身份 / 用户 ─────────────────────────────────
CALL delete_table_if_exists('bg_kyc_doc_log');
CALL delete_table_if_exists('bg_kyc_submission');
CALL delete_table_if_exists('bg_kyc');
CALL delete_table_if_exists('bg_login_log');
CALL delete_table_if_exists('bg_session');
CALL delete_table_if_exists('bg_user_identity');
CALL delete_table_if_exists('bg_user_profile');
CALL delete_table_if_exists('bg_user');

DROP PROCEDURE IF EXISTS delete_table_if_exists;
DROP PROCEDURE IF EXISTS exec_if_table_exists;

SET FOREIGN_KEY_CHECKS = 1;

-- ── 验证：这些用户数据表应为 0 ───────────────────────────────
SELECT 'bg_user' AS tbl, COUNT(*) AS remaining FROM bg_user
UNION ALL SELECT 'bg_wallet', COUNT(*) FROM bg_wallet
UNION ALL SELECT 'bg_wallet_ledger', COUNT(*) FROM bg_wallet_ledger
UNION ALL SELECT 'bg_deposit_order', COUNT(*) FROM bg_deposit_order
UNION ALL SELECT 'bg_withdraw_order', COUNT(*) FROM bg_withdraw_order
UNION ALL SELECT 'bg_bet_order', COUNT(*) FROM bg_bet_order
UNION ALL SELECT 'bg_aggregator_player', COUNT(*) FROM bg_aggregator_player
UNION ALL SELECT 'bg_568win_wallet_txn', COUNT(*) FROM bg_568win_wallet_txn
UNION ALL SELECT 'bg_568win_report_bet', COUNT(*) FROM bg_568win_report_bet
UNION ALL SELECT 'bg_team_node', COUNT(*) FROM bg_team_node
UNION ALL SELECT 'bg_team_wallet', COUNT(*) FROM bg_team_wallet
UNION ALL SELECT 'bg_agent', COUNT(*) FROM bg_agent
UNION ALL SELECT 'bg_spin_chance', COUNT(*) FROM bg_spin_chance
UNION ALL SELECT 'bg_spin_record', COUNT(*) FROM bg_spin_record
UNION ALL SELECT 'bg_kyc', COUNT(*) FROM bg_kyc
UNION ALL SELECT 'bg_user_identity', COUNT(*) FROM bg_user_identity
UNION ALL SELECT 'bg_login_log', COUNT(*) FROM bg_login_log
UNION ALL SELECT 'bg_task_claim', COUNT(*) FROM bg_task_claim
UNION ALL SELECT 'bg_user_vip_state', COUNT(*) FROM bg_user_vip_state
UNION ALL SELECT 'bg_user_segment', COUNT(*) FROM bg_user_segment;
