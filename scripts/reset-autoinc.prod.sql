-- 用户数据清空后，将被清理表的 AUTO_INCREMENT 归零，让正式运营的 ID 从 1 开始
-- 幂等 & 抗结构漂移：仅对「存在」且「含 AUTO_INCREMENT 列」的表执行，配置表一律不动
-- 配合 clear-all-user-data.sql 使用，须在其之后执行

DROP PROCEDURE IF EXISTS reset_autoinc_if_exists;

DELIMITER //
CREATE PROCEDURE reset_autoinc_if_exists(IN p_table_name VARCHAR(64))
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = p_table_name
      AND EXTRA = 'auto_increment'
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', REPLACE(p_table_name, '`', '``'), '` AUTO_INCREMENT = 1');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END//
DELIMITER ;

-- 与 clear-all-user-data.sql 中被 DELETE 的表一一对应（bg_agent_domain / bg_agent_bot 仅置空不删，故不含）
CALL reset_autoinc_if_exists('admin_audit_log');
CALL reset_autoinc_if_exists('cs_message');
CALL reset_autoinc_if_exists('cs_conversation');
CALL reset_autoinc_if_exists('bg_task_manual_review');
CALL reset_autoinc_if_exists('bg_task_social_claim');
CALL reset_autoinc_if_exists('bg_task_claim');
CALL reset_autoinc_if_exists('bg_vip_reward_log');
CALL reset_autoinc_if_exists('bg_user_vip_state');
CALL reset_autoinc_if_exists('bg_redep_offer');
CALL reset_autoinc_if_exists('bg_app_download_claim');
CALL reset_autoinc_if_exists('bg_channel_deposit_bonus_claim');
CALL reset_autoinc_if_exists('bg_checkin_log');
CALL reset_autoinc_if_exists('bg_promo_claim');
CALL reset_autoinc_if_exists('bg_referral_record');
CALL reset_autoinc_if_exists('bg_user_promo_state');
CALL reset_autoinc_if_exists('bg_risk_hit_log');
CALL reset_autoinc_if_exists('bg_user_risk_signal');
CALL reset_autoinc_if_exists('bg_user_tag');
CALL reset_autoinc_if_exists('bg_user_segment');
CALL reset_autoinc_if_exists('bg_568win_wallet_txn');
CALL reset_autoinc_if_exists('bg_568win_report_bet');
CALL reset_autoinc_if_exists('bg_aggregator_player');
CALL reset_autoinc_if_exists('bg_game_launch');
CALL reset_autoinc_if_exists('bg_game_session');
CALL reset_autoinc_if_exists('bg_bet_order');
CALL reset_autoinc_if_exists('bg_agent_commission');
CALL reset_autoinc_if_exists('bg_agent_ggr_monthly');
CALL reset_autoinc_if_exists('bg_user_agent');
CALL reset_autoinc_if_exists('bg_agent_channel');
CALL reset_autoinc_if_exists('bg_agent');
CALL reset_autoinc_if_exists('bg_team_withdraw_review_log');
CALL reset_autoinc_if_exists('bg_team_withdrawal');
CALL reset_autoinc_if_exists('bg_team_commission');
CALL reset_autoinc_if_exists('bg_team_ggr_monthly');
CALL reset_autoinc_if_exists('bg_team_turnover_daily');
CALL reset_autoinc_if_exists('bg_team_wallet');
CALL reset_autoinc_if_exists('bg_team_node');
CALL reset_autoinc_if_exists('bg_turnover_allocations');
CALL reset_autoinc_if_exists('bg_turnover_logs');
CALL reset_autoinc_if_exists('bg_turnover_requirements');
CALL reset_autoinc_if_exists('bg_rebate_record');
CALL reset_autoinc_if_exists('bg_spin_record');
CALL reset_autoinc_if_exists('bg_spin_chance');
CALL reset_autoinc_if_exists('bg_withdraw_review_log');
CALL reset_autoinc_if_exists('bg_withdraw_order');
CALL reset_autoinc_if_exists('bg_deposit_order');
CALL reset_autoinc_if_exists('bg_matrix_withdraw_order');
CALL reset_autoinc_if_exists('bg_matrix_deposit_order');
CALL reset_autoinc_if_exists('bg_matrix_deposit_address');
CALL reset_autoinc_if_exists('bg_order_withdraw');
CALL reset_autoinc_if_exists('bg_order_deposit');
CALL reset_autoinc_if_exists('bg_payment_order');
CALL reset_autoinc_if_exists('bg_wallet_ledger');
CALL reset_autoinc_if_exists('bg_wallet');
CALL reset_autoinc_if_exists('bg_idempotency');
CALL reset_autoinc_if_exists('bg_kyc_doc_log');
CALL reset_autoinc_if_exists('bg_kyc_submission');
CALL reset_autoinc_if_exists('bg_kyc');
CALL reset_autoinc_if_exists('bg_login_log');
CALL reset_autoinc_if_exists('bg_session');
CALL reset_autoinc_if_exists('bg_user_identity');
CALL reset_autoinc_if_exists('bg_user_profile');
CALL reset_autoinc_if_exists('bg_user');

DROP PROCEDURE IF EXISTS reset_autoinc_if_exists;
