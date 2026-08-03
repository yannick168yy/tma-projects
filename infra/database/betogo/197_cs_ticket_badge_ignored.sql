-- 197: 客服工单支持忽略后台待办提醒
SET NAMES utf8mb4;

ALTER TABLE cs_conversation
  ADD COLUMN badge_ignored TINYINT(1) NOT NULL DEFAULT 0 COMMENT '后台已忽略该客服工单提醒(1=忽略)' AFTER user_ticket_read_message_id;
