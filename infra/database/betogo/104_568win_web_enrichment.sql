-- 104: 568Win 联网富化字段
-- 事实列只接受带出处（web_sources）的值；tagline/description_tl 为生成类
SET NAMES utf8mb4;

ALTER TABLE bg_568win_game_override
  ADD COLUMN volatility VARCHAR(8) NULL COMMENT '波动率 low/mid/high' AFTER player_type,
  ADD COLUMN max_win_multiplier INT NULL COMMENT '最大赔付倍数，如 5000=x5000' AFTER volatility,
  ADD COLUMN rtp_official DECIMAL(5,2) NULL COMMENT '厂商官方标称RTP，与上游 rtp 并存比对' AFTER max_win_multiplier,
  ADD COLUMN release_date DATE NULL COMMENT '游戏发布日期' AFTER rtp_official,
  ADD COLUMN min_bet DECIMAL(12,2) NULL COMMENT '最低投注(PHP口径)' AFTER release_date,
  ADD COLUMN max_bet DECIMAL(12,2) NULL COMMENT '最高投注(PHP口径)' AFTER min_bet,
  ADD COLUMN series VARCHAR(64) NULL COMMENT '系列归组 slug，如 fortune-gems' AFTER max_bet,
  ADD COLUMN features JSON NULL COMMENT '机制标签数组 buy_bonus/free_spins/...' AFTER series,
  ADD COLUMN similar_games JSON NULL COMMENT '相似游戏 uuid 数组' AFTER features,
  ADD COLUMN risk_flags JSON NULL COMMENT '风险信号数组，空=干净' AFTER similar_games,
  ADD COLUMN tagline_en VARCHAR(160) NULL COMMENT '英文一句话卖点' AFTER risk_flags,
  ADD COLUMN tagline_tl VARCHAR(160) NULL COMMENT 'Taglish 一句话卖点' AFTER tagline_en,
  ADD COLUMN description_tl TEXT NULL COMMENT 'Taglish 简介' AFTER description_zh,
  ADD COLUMN web_sources JSON NULL COMMENT '联网富化各字段出处快照 {field:{value,source_url,confidence}}' AFTER tagline_tl,
  ADD COLUMN web_enriched_at DATETIME(3) NULL COMMENT '联网富化时间' AFTER web_sources,
  ADD KEY idx_volatility (volatility),
  ADD KEY idx_series (series);
