-- 删除旧订单表（已被 bg_deposit_order / bg_withdraw_order 取代）
DROP TABLE IF EXISTS bg_order_deposit;
DROP TABLE IF EXISTS bg_order_withdraw;
DROP TABLE IF EXISTS bg_matrix_deposit_order;
DROP TABLE IF EXISTS bg_matrix_withdraw_order;
