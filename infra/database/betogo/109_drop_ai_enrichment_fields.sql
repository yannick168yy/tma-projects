-- 109: 删除 568Win AI 富化字段
-- 数据已于 2026-07-05 导出备份到 /Users/yannicky/TMA_FILES/568win-ai-enrichment-backup-2026-07-05.jsonl（1788 行）
-- 保留：weight/is_featured/weight_breakdown/weight_updated_at（竞品策略在用）、
--       sort_category/site_category/name_override/image_override（人工运营字段）
SET NAMES utf8mb4;

ALTER TABLE bg_568win_game_override
  DROP COLUMN ph_bonus,
  DROP COLUMN theme,
  DROP COLUMN game_style,
  DROP COLUMN player_type,
  DROP COLUMN description_en,
  DROP COLUMN description_zh,
  DROP COLUMN description_tl,
  DROP COLUMN search_keywords,
  DROP COLUMN volatility,
  DROP COLUMN max_win_multiplier,
  DROP COLUMN rtp_official,
  DROP COLUMN release_date,
  DROP COLUMN min_bet,
  DROP COLUMN max_bet,
  DROP COLUMN series,
  DROP COLUMN features,
  DROP COLUMN similar_games,
  DROP COLUMN risk_flags,
  DROP COLUMN tagline_en,
  DROP COLUMN tagline_tl,
  DROP COLUMN web_sources,
  DROP COLUMN web_enriched_at;
