-- 渠道充值奖励（如 Maya 单笔满额送）：一人一渠道一次领取记录（领取校验 + 订单归因）
CREATE TABLE IF NOT EXISTS bg_channel_deposit_bonus_claim (
  user_id VARCHAR(32) NOT NULL,
  channel VARCHAR(32) NOT NULL COMMENT '渠道名，如 maya',
  amount DECIMAL(12,2) NOT NULL COMMENT '奖励金额',
  deposit_order_id VARCHAR(64) NOT NULL COMMENT '触发的存款单号',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, channel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='渠道充值奖励领取记录';
