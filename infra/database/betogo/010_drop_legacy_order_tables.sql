-- 010: 删除已废弃的旧订单表（数据已在 008 迁移至 bg_order_deposit / bg_order_withdraw）
DROP TABLE IF EXISTS `bg_deposit_order`;
DROP TABLE IF EXISTS `bg_withdraw_order`;
