-- 160: Telegram 社群任务改为引导关注官方频道，领取时校验频道成员身份

UPDATE `bg_task_social`
SET
  `platform` = 'telegram',
  `verify_strategy` = 'tg_member',
  `title` = '关注官方 Telegram 频道',
  `subtitle` = '加入频道领奖励',
  `action_url` = 'https://t.me/betogo_gaming',
  `channel_ref` = '@betogo_gaming'
WHERE `task_key` = 'follow_telegram';
