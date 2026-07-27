-- 180: 客服 AI 总结持久化
SET NAMES utf8mb4;

ALTER TABLE cs_conversation
  ADD COLUMN ai_summary TEXT NULL COMMENT '客服 AI 总结内容' AFTER user_left_at,
  ADD COLUMN ai_summary_model VARCHAR(64) NULL COMMENT '生成总结的模型' AFTER ai_summary,
  ADD COLUMN ai_summary_message_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '生成总结时使用的消息数' AFTER ai_summary_model,
  ADD COLUMN ai_summary_updated_at DATETIME NULL COMMENT 'AI 总结更新时间' AFTER ai_summary_message_count;
