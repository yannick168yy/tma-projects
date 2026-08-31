-- 印尼站对外运营前，历史用户与历史活跃数据均归属菲律宾市场。
SET NAMES utf8mb4;

INSERT INTO `bi_daily_active` (`stat_date`, `market`, `new_users`, `dau`, `login_count`, `updated_at`)
SELECT `stat_date`, 'PH', `new_users`, `dau`, `login_count`, `updated_at`
FROM `bi_daily_active`
WHERE `market` = 'ALL'
ON DUPLICATE KEY UPDATE
  `new_users` = VALUES(`new_users`),
  `dau` = VALUES(`dau`),
  `login_count` = VALUES(`login_count`);
