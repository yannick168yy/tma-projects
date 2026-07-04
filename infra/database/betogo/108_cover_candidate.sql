-- 多源封面候选：每款 568win 游戏在各竞品源匹配到的候选封面，供后台换图弹窗选择
-- 数据由 scripts/cover-candidates/build.mjs 生成并手动灌入（DELETE+INSERT，不进迁移）
-- 568win 上游原图不入此表，由后端从 icon_url 直接补充
CREATE TABLE IF NOT EXISTS `bg_568win_game_cover_candidate` (
  `game_provider_id` INT          NOT NULL,
  `game_id`          INT          NOT NULL,
  `source`           VARCHAR(32)  NOT NULL COMMENT 'playtime/fbmplay/gzone/casinoplus',
  `url`              VARCHAR(512) NOT NULL COMMENT '静态封面URL',
  `anim_url`         VARCHAR(512) NULL COMMENT '动图URL(仅 playtime 部分游戏有)',
  PRIMARY KEY (`game_provider_id`, `game_id`, `source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='568Win 游戏多源封面候选';
