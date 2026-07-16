-- 151: 总流水累计列 —— 消除 getUserTotalTurnover 对 bg_turnover_logs 的全量 SUM
-- 背景（压测 P5 实证，优化清单#11）：该 SUM 随数据量线性放大，3 倍数据下
--   /rebate/progress 容量 188→84 rps（-55%）、/vip/progress p95@40 866ms 破线。
-- 方案（仿 bg_bet_round 预聚合思路）：bg_user_vip_state 加 turnover_total 列，
--   core 写侧同事务增量维护（allocate 累加 / reverse 减量），读侧变单行主键查。

SET NAMES utf8mb4;

ALTER TABLE `bg_user_vip_state`
  ADD COLUMN `turnover_total` DECIMAL(18,4) NOT NULL DEFAULT 0
    COMMENT '有效流水累计（is_reversed=0 口径，写侧事务内增量维护）' AFTER `task_growth`;

-- 回填存量（幂等重算，可在生产 core 部署后手动重放本条以闭合部署间隙）
INSERT INTO `bg_user_vip_state` (`user_id`, `currency`, `turnover_total`)
SELECT `user_id`, `currency`, SUM(`effective_amount`)
FROM `bg_turnover_logs`
WHERE `is_reversed` = 0
GROUP BY `user_id`, `currency`
ON DUPLICATE KEY UPDATE `turnover_total` = VALUES(`turnover_total`);
