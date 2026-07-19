-- 147: 客服会话生命周期，记录用户离开客服弹框的时间
SET NAMES utf8mb4;

ALTER TABLE cs_conversation
  ADD COLUMN user_left_at DATETIME NULL AFTER escalated_at;
