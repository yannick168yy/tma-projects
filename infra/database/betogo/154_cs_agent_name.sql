-- 客服会话分配的客服名(真人身份化),空值由代码按会话 id 兜底
ALTER TABLE `cs_conversation` ADD COLUMN `agent_name` VARCHAR(32) NULL AFTER `assigned_admin_id`;
