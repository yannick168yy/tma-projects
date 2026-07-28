-- 站内公告：两个固定展示位
--   top_marquee      顶部通栏滚动跑马灯（全站，顶部菜单栏下方）
--   home_banner_top  首页 banner 上方的一般公告
-- 每个位可后台配置：开关、四语言文案、可选起止时间（时间窗，存 UTC，空=不限）
CREATE TABLE IF NOT EXISTS bg_announcement (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  placement  VARCHAR(32)  NOT NULL,
  enabled    TINYINT(1)   NOT NULL DEFAULT 0,
  content_en TEXT         NOT NULL,
  content_zh TEXT         NOT NULL,
  content_id TEXT         NOT NULL,
  content_vi TEXT         NOT NULL,
  starts_at  DATETIME     NULL,
  ends_at    DATETIME     NULL,
  updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_placement (placement)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO bg_announcement (placement, enabled, content_en, content_zh, content_id, content_vi) VALUES
  ('top_marquee',     0, '', '', '', ''),
  ('home_banner_top', 0, '', '', '', '');
