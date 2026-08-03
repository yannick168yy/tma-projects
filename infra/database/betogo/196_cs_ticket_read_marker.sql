-- 196: 客服工单用户侧已读指针
SET NAMES utf8mb4;

ALTER TABLE cs_conversation
  ADD COLUMN user_ticket_read_message_id BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '用户侧工单已读到的 cs_message.id' AFTER user_left_at;
