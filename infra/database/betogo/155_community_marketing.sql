-- 社区营销自动发帖:渠道 / 内容模板 / 轮播规则 / 发帖日志

CREATE TABLE IF NOT EXISTS `cm_channel` (
  `id`          int unsigned NOT NULL AUTO_INCREMENT,
  `platform`    varchar(16)  NOT NULL COMMENT 'telegram | viber | facebook',
  `name`        varchar(64)  NOT NULL COMMENT '后台显示名,如 "BetoGo TG 主频道"',
  `config`      json         NOT NULL COMMENT 'telegram:{chatId,botToken?} viber:{authToken,from} facebook:{pageId,pageToken?}',
  `daily_limit` int unsigned NOT NULL DEFAULT 10 COMMENT '单渠道每日发帖上限,防配置失误刷屏',
  `enabled`     tinyint(1)   NOT NULL DEFAULT 1,
  `created_at`  timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cm_template` (
  `id`          int unsigned NOT NULL AUTO_INCREMENT,
  `category`    varchar(16)  NOT NULL COMMENT 'promo | winner | hotgame | sports | checkin | festival',
  `title`       varchar(128) NOT NULL COMMENT '后台管理用名称',
  `body`        text         NOT NULL COMMENT '文案,支持变量 {player} {amount} {game} {game1..3} {date}',
  `image_url`   varchar(512) DEFAULT NULL,
  `buttons`     json         DEFAULT NULL COMMENT '[{text,url}] TG inline按钮;FB/Viber 追加为文末链接',
  `enabled`     tinyint(1)   NOT NULL DEFAULT 1,
  `sort`        int          NOT NULL DEFAULT 0,
  `created_at`  timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_category` (`category`, `enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cm_rule` (
  `id`          int unsigned NOT NULL AUTO_INCREMENT,
  `name`        varchar(64)  NOT NULL,
  `category`    varchar(16)  NOT NULL COMMENT '从该栏目模板池轮换',
  `channel_ids` json         NOT NULL COMMENT '目标渠道 id 数组',
  `slots`       json         NOT NULL COMMENT '每日发送时刻(PHT) ["10:00","19:00"]',
  `strategy`    varchar(16)  NOT NULL DEFAULT 'sequential' COMMENT 'sequential | random',
  `ai_rewrite`  tinyint(1)   NOT NULL DEFAULT 1 COMMENT '发送前是否 AI 变体改写',
  `cursor`      int unsigned NOT NULL DEFAULT 0 COMMENT 'sequential 轮换游标',
  `enabled`     tinyint(1)   NOT NULL DEFAULT 1,
  `created_at`  timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cm_post_log` (
  `id`          bigint unsigned NOT NULL AUTO_INCREMENT,
  `rule_id`     int unsigned DEFAULT NULL COMMENT 'NULL=后台手动发送',
  `channel_id`  int unsigned NOT NULL,
  `template_id` int unsigned DEFAULT NULL,
  `content`     text         NOT NULL COMMENT '实发内容快照(AI 改写后)',
  `image_url`   varchar(512) DEFAULT NULL,
  `buttons`     json         DEFAULT NULL,
  `status`      varchar(16)  NOT NULL DEFAULT 'pending' COMMENT 'pending(FB待人工确认) | sent | failed | skipped',
  `error`       varchar(512) DEFAULT NULL,
  `sent_at`     timestamp    NULL DEFAULT NULL,
  `created_at`  timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_channel_day` (`channel_id`, `created_at`),
  KEY `idx_status` (`status`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 默认模板种子(英语+Taglish,变量由程序注入;仅首次迁移插入)
INSERT INTO `cm_template` (`category`, `title`, `body`, `buttons`) VALUES
('winner', '大奖喜报-通用', '🎉 CONGRATS! Player {player} just won {amount} on {game}! 🔥\n\nGrabe ang swerte today! Ikaw na kaya ang next big winner?\n\n👉 Play now and try your luck!', JSON_ARRAY(JSON_OBJECT('text', '🎰 Play Now', 'url', 'https://www.188facai.com'))),
('winner', '大奖喜报-连胜', '💰 JACKPOT ALERT! {player} hit {amount} sa {game}!\n\nLakas ng hataw ngayon — the games are HOT today! 🔥🔥', JSON_ARRAY(JSON_OBJECT('text', '🎮 Join the Action', 'url', 'https://www.188facai.com'))),
('hotgame', '今日热游Top3', '🔥 TRENDING TODAY 🔥\n\n🥇 {game1}\n🥈 {game2}\n🥉 {game3}\n\nThese games are on fire today mga ka-BetoGo! Sali na!', JSON_ARRAY(JSON_OBJECT('text', '🎰 Play Trending Games', 'url', 'https://www.188facai.com'))),
('checkin', '签到提醒-通用', '📅 {date}\n\nNa-claim mo na ba ang daily check-in reward mo today? 🎁\n\nFree rewards every day — wag palampasin! ⏰', JSON_ARRAY(JSON_OBJECT('text', '✅ Claim Now', 'url', 'https://www.188facai.com'))),
('promo', '活动推广-示例(请改成真实活动)', '🎁 SPECIAL PROMO!\n\n[后台编辑:填入真实活动内容与链接]\n\nLimited time lang ito — grab it now!', NULL);
