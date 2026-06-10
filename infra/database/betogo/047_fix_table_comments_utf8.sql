-- 047: 修复表注释乱码和空注释
-- 根本原因：之前迁移未加 --default-character-set=utf8mb4，中文被 latin1 double-encode
-- 本迁移在 utf8mb4 连接下覆盖写入，还原正确中文注释

ALTER TABLE bg_game_turnover_rates    COMMENT '游戏大类流水贡献率';
ALTER TABLE bg_matrix_deposit_address COMMENT 'Matrix 充值地址缓存';
ALTER TABLE bg_turnover_allocations   COMMENT '流水要求分配明细';
ALTER TABLE bg_turnover_logs          COMMENT '投注流水明细';
ALTER TABLE bg_turnover_requirements  COMMENT '用户流水要求';
ALTER TABLE bg_deposit_order          COMMENT '存款订单';
ALTER TABLE bg_wallet                 COMMENT '用户钱包余额（多币种）';
ALTER TABLE bg_withdraw_order         COMMENT '提款订单';
