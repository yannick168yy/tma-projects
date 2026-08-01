-- 首页板块「显示/隐藏」开关：运营可按 (板块, 币种) 把整块从前台首页隐藏。
-- 隐藏只影响前台渲染，不清空板块内容——后台仍能正常编辑钉/移除/冻结，取消隐藏后原样恢复。
-- 无该 (板块,币种) 行 或 hidden=0 = 显示。
CREATE TABLE IF NOT EXISTS bg_homepage_section_visibility (
  section_key VARCHAR(32) NOT NULL,
  currency    VARCHAR(8)  NOT NULL,   -- PHP | USDT
  hidden      TINYINT(1)  NOT NULL DEFAULT 0,
  updated_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (section_key, currency)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
