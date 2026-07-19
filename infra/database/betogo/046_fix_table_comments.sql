-- 046: 补全空注释表的 TABLE COMMENT
-- bg_deposit_order / bg_wallet / bg_withdraw_order 原来注释为空

ALTER TABLE bg_deposit_order  COMMENT '存款订单';
ALTER TABLE bg_wallet         COMMENT '用户钱包余额（多币种）';
ALTER TABLE bg_withdraw_order COMMENT '提款订单';
