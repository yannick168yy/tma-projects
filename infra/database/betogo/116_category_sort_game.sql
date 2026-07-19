-- Games 页各分类「All（全部厂商）」列表的手动置顶排序。
-- 机制=手动排序 + 缺省：这张表里的游戏按 position 升序钉在分类列表最前，
-- 其余游戏保持默认权重(weight)排序垫后。仅作用于 provider=all 且按权重排序的列表。
-- category_key 取值 = Games 页一级分类 id：
--   all / slot / casino / perya / poker / fishing / sports / lottery / other
CREATE TABLE IF NOT EXISTS `bg_category_sort_game` (
  `id`           BIGINT       NOT NULL AUTO_INCREMENT,
  `category_key` VARCHAR(32)  NOT NULL COMMENT '一级分类 id，all 表示全部分类聚合',
  `game_uuid`    VARCHAR(64)  NOT NULL COMMENT '游戏 uuid，如 568win:pid:gid',
  `position`     INT          NOT NULL DEFAULT 0 COMMENT '手动排序位次(0-based)，越小越靠前',
  `created_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cat_game` (`category_key`, `game_uuid`),
  KEY `idx_cat` (`category_key`, `position`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Games 页分类 All 列表手动置顶排序';
