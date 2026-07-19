CREATE TABLE IF NOT EXISTS `bg_virtual_game_config` (
  `uuid`           VARCHAR(64)  NOT NULL COMMENT '虚拟游戏入口 uuid',
  `provider`       VARCHAR(128) NOT NULL,
  `name`           VARCHAR(255) NOT NULL,
  `name_zh`        VARCHAR(255) NULL,
  `category`       VARCHAR(64)  NULL,
  `sort_category`  VARCHAR(32)  NOT NULL,
  `site_category`  VARCHAR(32)  NOT NULL,
  `is_active`      TINYINT(1)   NOT NULL DEFAULT 1,
  `weight`         INT          NOT NULL DEFAULT 10000,
  `is_featured`    TINYINT(1)   NOT NULL DEFAULT 1,
  `image_override` VARCHAR(512) NULL,
  `image_source`   VARCHAR(64)  NULL,
  `supported_currencies` JSON   NULL,
  `created_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`uuid`),
  KEY `idx_active_category` (`is_active`, `site_category`),
  KEY `idx_sort_category` (`sort_category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='虚拟游戏入口运营配置';

INSERT INTO `bg_virtual_game_config`
  (`uuid`, `provider`, `name`, `name_zh`, `category`, `sort_category`, `site_category`, `is_active`, `weight`, `is_featured`, `supported_currencies`)
VALUES
  ('568win:sportsbook', '365Win Sports', '365Win Sports', '365Win 体育', 'sportsbook', 'sports', 'sports', 1, 10000, 1, JSON_ARRAY('PHP', 'USDT'))
ON DUPLICATE KEY UPDATE
  `provider` = VALUES(`provider`),
  `name` = VALUES(`name`),
  `name_zh` = VALUES(`name_zh`),
  `category` = VALUES(`category`),
  `sort_category` = VALUES(`sort_category`),
  `site_category` = VALUES(`site_category`);
