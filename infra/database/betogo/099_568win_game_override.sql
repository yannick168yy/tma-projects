CREATE TABLE `bg_568win_game_override` (
  `game_provider_id` INT          NOT NULL COMMENT '568Win gameProviderId/GpId',
  `game_id`          INT          NOT NULL COMMENT '568Win gameID',
  `is_active`        TINYINT(1)   NULL COMMENT '本地上下架，NULL 表示跟随上游可用状态',
  `weight`           INT          NULL COMMENT '本地排序权重',
  `is_featured`      TINYINT(1)   NULL COMMENT '本地推荐标记',
  `sort_category`    VARCHAR(32)  NULL COMMENT '本地前端分类覆盖',
  `name_override`    VARCHAR(255) NULL COMMENT '本地展示名覆盖',
  `image_override`   VARCHAR(512) NULL COMMENT '本地图片覆盖',
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`game_provider_id`, `game_id`),
  KEY `idx_active` (`is_active`),
  KEY `idx_featured` (`is_featured`),
  KEY `idx_sort_category` (`sort_category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='568Win 游戏本地运营配置';
