-- P3-2 底部导航可配：5 个槽位的顺序、显示、图标、跳转目标按租户配。
--
-- 无行 = 全部用代码默认值，所以不需要种子数据；租户后台第一次保存才写行。
-- 与首页布局（bg_homepage_section_visibility）同一套思路：配置表只存「偏离默认的部分」，
-- 默认长什么样仍由代码定义，避免升级时要迁移一堆和默认值一样的行。
CREATE TABLE IF NOT EXISTS `bg_bottom_nav` (
  `nav_id`      VARCHAR(32) NOT NULL COMMENT '槽位：casino/bonuses/team/games/menu',
  `hidden`      TINYINT(1)  NOT NULL DEFAULT 0,
  `sort_order`  INT         NOT NULL DEFAULT 0 COMMENT '小的在前；0=用代码默认位置',
  `icon`        VARCHAR(32) NULL COMMENT '图标名（白名单内），NULL=用该槽位默认图标',
  `target_path` VARCHAR(64) NULL COMMENT '跳转目标（白名单内），NULL=用该槽位默认页面',
  `updated_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`nav_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='底部导航配置（P3-2）';
