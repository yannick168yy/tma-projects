-- 043: 删除所有死表
-- bg_order_deposit / bg_payment_order: 早期订单表，已被 bg_deposit_order/bg_withdraw_order 取代
-- bg_session: SQL session，已改用 Redis
-- bg_game_session / bg_referral_record / bg_promo_claim: 功能未实现，无数据
-- bg_fix_faq_encoding / bg_team_optin / bg_wallet_ledger_team_type: 迁移哨兵，无业务用途

DROP TABLE IF EXISTS bg_order_deposit;
DROP TABLE IF EXISTS bg_payment_order;
DROP TABLE IF EXISTS bg_session;
DROP TABLE IF EXISTS bg_game_session;
DROP TABLE IF EXISTS bg_referral_record;
DROP TABLE IF EXISTS bg_promo_claim;
DROP TABLE IF EXISTS bg_fix_faq_encoding;
DROP TABLE IF EXISTS bg_team_optin;
DROP TABLE IF EXISTS bg_wallet_ledger_team_type;
