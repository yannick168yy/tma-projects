-- 061: 佣金提现加入审核轨道
-- 所有提现统一走取款审核模块，佣金提现默认转人工处理
ALTER TABLE `bg_team_withdrawal`
  ADD COLUMN IF NOT EXISTS `review_verdict` ENUM('pass','manual') NOT NULL DEFAULT 'manual'
    COMMENT '审核结论，佣金提现固定 manual' AFTER `status`,
  ADD COLUMN IF NOT EXISTS `handled_by`     VARCHAR(64)  NULL
    COMMENT '处理人 admin username' AFTER `reviewed_at`,
  ADD COLUMN IF NOT EXISTS `handled_at`     DATETIME(3) NULL
    COMMENT '人工处理时间' AFTER `handled_by`;
