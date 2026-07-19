-- Slotegrator game list cache (added in Slotegrator integration)
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `sg_games` (
  `uuid`          VARCHAR(128) NOT NULL COMMENT 'Slotegrator game_uuid',
  `name`          VARCHAR(255) NOT NULL,
  `provider`      VARCHAR(128) NOT NULL COMMENT '供应商代码，如 PRAGMATIC',
  `category`      VARCHAR(64)  NULL,
  `sub_category`  VARCHAR(64)  NULL,
  `image_url`     VARCHAR(512) NULL,
  `has_demo`      TINYINT(1)   NOT NULL DEFAULT 1,
  `has_lobby`     TINYINT(1)   NOT NULL DEFAULT 0,
  `is_mobile`     TINYINT(1)   NOT NULL DEFAULT 1,
  `tags`          JSON         NULL,
  `features`      JSON         NULL,
  `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`uuid`),
  KEY `idx_provider` (`provider`),
  KEY `idx_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Slotegrator 游戏列表缓存';
