-- P2-7/P2-8 双资金模式：每笔充提记下走的是平台代收还是租户自带通道。
--
-- 为什么要落在订单上而不是每次按通道归属回溯：通道归属会变（客户中途接自己的通道，
-- 或平台把某个通道收回自营），改完之后历史订单按新归属回溯就会算出另一套账单，
-- 而那些账单客户已经确认过了。
--
-- NULL = 该字段上线前的历史单，对账时按当前通道归属兜底判定。
ALTER TABLE `bg_deposit_order`
  ADD COLUMN `settlement_mode` ENUM('platform','tenant') NULL
    COMMENT '资金模式：platform=平台代收，tenant=租户自带通道；NULL=字段上线前的历史单' AFTER `channel`,
  ADD KEY `idx_settlement_mode` (`settlement_mode`, `created_at`);

ALTER TABLE `bg_withdraw_order`
  ADD COLUMN `settlement_mode` ENUM('platform','tenant') NULL
    COMMENT '资金模式：platform=平台代付，tenant=租户自己放款；NULL=字段上线前的历史单' AFTER `channel`,
  ADD KEY `idx_settlement_mode` (`settlement_mode`, `created_at`);
