-- 下线「绑定 Telegram」社群任务（bind_only 策略整体废弃）
-- 精确 WHERE 的一次性删除；schema_migrations 保证本文件只执行一次
DELETE FROM bg_task_social WHERE task_key = 'bind_telegram' AND verify_strategy = 'bind_only';
