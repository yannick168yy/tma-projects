-- 193: 任务/签到表补时间维度索引，支撑后台「任务成长总览」按日期范围聚合
--   bg_task_claim 原索引只有 (user_id,...)，按 created_at 范围统计会全表扫
--   bg_checkin_log 同理，checkin_date 只出现在 (user_id, checkin_date) 组合索引里

ALTER TABLE `bg_task_claim` ADD KEY `idx_created` (`created_at`);
ALTER TABLE `bg_checkin_log` ADD KEY `idx_date` (`checkin_date`);
