-- 首页板块「手动干预」存储（Phase A）：在现有推荐策略之上，对每个板块手动
-- 钉位(pin)或排除(exclude)特定游戏。策略负责打底，这张表负责手工微调。
-- section_key 取值与后端 HomepageSelection 一致：
--   popular / highRebate / newGames / slots / casino / perya / fishing / lottery / mythology / megaWin
-- currency='' 表示全币种生效；'PHP'/'USDT' 表示仅该币种（USDT 含 UCC）。
CREATE TABLE IF NOT EXISTS `bg_homepage_section_game` (
  `id`            BIGINT       NOT NULL AUTO_INCREMENT,
  `section_key`   VARCHAR(32)  NOT NULL COMMENT '板块键，与 HomepageSelection 字段名一致',
  `game_uuid`     VARCHAR(64)  NOT NULL COMMENT '游戏 uuid，如 568win:pid:gid',
  `action`        ENUM('pin','exclude') NOT NULL COMMENT 'pin=强制置顶/纳入, exclude=从该板块剔除',
  `pin_position`  INT          NULL COMMENT '钉到第几位(1-based)，NULL=前插按 sort_order',
  `currency`      VARCHAR(8)   NOT NULL DEFAULT '' COMMENT '空=全币种, PHP/USDT=仅该币种',
  `sort_order`    INT          NOT NULL DEFAULT 0 COMMENT '无 pin_position 时的相对顺序',
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_section_game_cur` (`section_key`, `game_uuid`, `currency`),
  KEY `idx_section` (`section_key`, `currency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='首页板块手动钉位/排除配置';
