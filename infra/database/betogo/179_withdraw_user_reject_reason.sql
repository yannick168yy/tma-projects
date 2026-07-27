-- 提款拒绝原因拆分：reject_reason 留后台内部备注，reject_reason_user 只放用户可见文案
ALTER TABLE bg_withdraw_order
  ADD COLUMN reject_reason_user VARCHAR(512) NULL COMMENT '用户可见提款拒绝原因' AFTER reject_reason;
