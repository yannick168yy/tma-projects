-- TG 群发:bot 私聊向全体 TG 用户推送运营消息(图+文案+内联按钮)

CREATE TABLE IF NOT EXISTS `tg_broadcast` (
  `id`            int unsigned    NOT NULL AUTO_INCREMENT,
  `title`         varchar(128)    NOT NULL COMMENT '后台管理用名称',
  `content`       text            NOT NULL COMMENT '文案,支持 Telegram HTML(<b> <i> <a>)',
  `image_key`     varchar(512)    DEFAULT NULL COMMENT '本地存储 key(home/broadcast/…),NULL=纯文字',
  `buttons`       json            DEFAULT NULL COMMENT '[{text,kind:url|webapp,url}] 每按钮一行',
  `status`        varchar(16)     NOT NULL DEFAULT 'draft' COMMENT 'draft | sending | done | canceled',
  `total`         int unsigned    NOT NULL DEFAULT 0 COMMENT '开始发送时快照的受众数',
  `sent_count`    int unsigned    NOT NULL DEFAULT 0,
  `failed_count`  int unsigned    NOT NULL DEFAULT 0 COMMENT '发送失败(非拉黑)',
  `blocked_count` int unsigned    NOT NULL DEFAULT 0 COMMENT '拉黑 bot / 从未 start / 账号注销',
  `cursor_id`     bigint unsigned NOT NULL DEFAULT 0 COMMENT '已处理到的 bg_user_identity.id,断点续发',
  `tg_file_id`    varchar(256)    DEFAULT NULL COMMENT '首次上传图片后 Telegram 返回的 file_id,后续复用免重传',
  `created_by`    varchar(64)     DEFAULT NULL,
  `started_at`    timestamp       NULL DEFAULT NULL,
  `finished_at`   timestamp       NULL DEFAULT NULL,
  `created_at`    timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tg_broadcast_fail` (
  `id`           bigint unsigned NOT NULL AUTO_INCREMENT,
  `broadcast_id` int unsigned    NOT NULL,
  `tg_id`        varchar(32)     NOT NULL,
  `user_id`      varchar(64)     DEFAULT NULL,
  `blocked`      tinyint(1)      NOT NULL DEFAULT 0 COMMENT '1=拉黑/未start/注销,0=其他失败',
  `error`        varchar(512)    DEFAULT NULL,
  `created_at`   timestamp       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_broadcast` (`broadcast_id`, `id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
