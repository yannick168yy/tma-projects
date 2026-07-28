-- 首页板块「冻结名单」：popular / recommended / highRebate 三块可由运营把
-- 「当前算法+钉的实际展示内容」冻结成固定有序名单，前台直接读该名单、不再跑推荐算法。
-- 维护中的游戏仍留在名单里（前端置灰保留，hydrate 恢复后自动变亮）。分币种 PHP/USDT 各一份。
-- 无该 (板块,币种) 行 = 未冻结，仍走算法。运营改动钉/权重后点「重新生成并冻结」刷新快照。
CREATE TABLE IF NOT EXISTS bg_homepage_frozen_board (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  section_key VARCHAR(32)  NOT NULL,
  currency    VARCHAR(8)   NOT NULL,   -- PHP | USDT
  game_uuid   VARCHAR(64)  NOT NULL,
  sort_order  INT          NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_frozen (section_key, currency, game_uuid),
  KEY idx_frozen_board (section_key, currency, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
