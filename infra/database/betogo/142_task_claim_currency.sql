-- 142: 任务领取记录唯一键加入 currency（每币种独立账号 · 留存类每日任务按币种各领一次）
--
-- 背景：daily_deposit/daily_bets/daily_play 等【留存/日常】任务改为按币种独立(USDT 用户按 USDT 口径达标/领奖)。
--   原唯一键 (user_id, task_id, period_key) 会让同一天同一任务只能领一次(不分币种)，
--   需把 currency 并入唯一键，允许 PHP/USDT/USDC 各领一次。
-- 拉新类一次性任务(profile_complete/first_game/invite_milestone)仍固定 PHP，currency='PHP' 唯一性不变。
--
-- currency 列已在 128 建表时存在(DEFAULT 'PHP')；此处只重建唯一键。幂等：information_schema 守卫。

SET NAMES utf8mb4;

SET @has = (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_task_claim'
    AND INDEX_NAME = 'uk_user_task_period' AND COLUMN_NAME = 'currency');
SET @sql = IF(@has = 0,
  "ALTER TABLE `bg_task_claim`
     DROP INDEX `uk_user_task_period`,
     ADD UNIQUE KEY `uk_user_task_period` (`user_id`, `task_id`, `period_key`, `currency`)",
  'SELECT 1');
PREPARE st FROM @sql; EXECUTE st; DEALLOCATE PREPARE st;
