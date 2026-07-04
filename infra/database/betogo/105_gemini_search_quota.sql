-- 105: Gemini Search grounding 每日额度计数
-- 定时富化、后台单游戏按钮、手动脚本共用，按太平洋日期计数，保证不超免费额度
SET NAMES utf8mb4;

CREATE TABLE bg_gemini_search_quota (
  quota_date DATE NOT NULL COMMENT '太平洋时间日期（Google 免费额度按 PT 刷新）',
  used INT NOT NULL DEFAULT 0 COMMENT '当日已消耗的 grounding 请求数',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (quota_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Gemini Search 每日免费额度计数';
