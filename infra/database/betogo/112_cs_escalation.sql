-- 112: 客服转人工升级 —— escalated 状态(离线工单,AI 继续应答) + 转接原因/时间
SET NAMES utf8mb4;

ALTER TABLE cs_conversation
  MODIFY COLUMN status ENUM('active','escalated','human_taken','resolved','closed') NOT NULL DEFAULT 'active',
  ADD COLUMN escalate_reason VARCHAR(64) NULL AFTER assigned_admin_id,
  ADD COLUMN escalated_at DATETIME NULL AFTER escalate_reason;
