-- Cashback Games 选品 v3：三档 2%/1.5%/1%（2026-07-12，手动执行,不进自动部署迁移）
--
-- ⚠️ 重要:精选档位是**真实结算费率**,不是纯展示——rebate.service SQL_EFFECTIVE_RATE_PCT
--    在洗码结算时 JOIN bg_rebate_featured_game,精选游戏按档位费率覆盖分级大类费率。
--
-- 盈亏铁律:返水越高的档位越卡高 hold(RTP 越低),各档独立 RTP 上限:
--   2% 档(≤5款):  RTP≤0.95(hold≥5%) → 洗码2% 占净GGR ~43%
--   1.5%档(≤20款): RTP≤0.96(hold≥4%) → 占净 ~41%
--   1% 档(≤100款): RTP≤0.97(hold≥3%) → 占净 ~36%(叠上级佣金0.5%后~54%),走量主力
-- 白名单厂商(分成≤7.5%):JILI 7.5/FC 7/FG 6/568W 6.5/CQ9 7/JDB 7/YGG 7/PG 7/BNG 7/HS 7.5/KA 7/NLC 7/5G 6/FS 6/NG 6
-- (排除 PP 8/PT 11/MG 8/HB 8/Apollo 9/AfricanBuffalo 12)

DELETE FROM bg_rebate_featured_game;

-- 复用同一白名单候选选品：每档从各自 RTP 上限的池里按热度权重降序取,已被高档选走的游戏不重复入低档
DROP TEMPORARY TABLE IF EXISTS tmp_cashback_pool;
CREATE TEMPORARY TABLE tmp_cashback_pool AS
SELECT CONCAT('568win:', g.game_provider_id, ':', g.game_id) AS uuid, g.rtp, o.weight, g.game_id
FROM bg_568win_game g
JOIN bg_568win_game_override o
  ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id
WHERE (o.is_active IS NULL OR o.is_active = 1)
  AND g.site_category_auto IN ('slot', 'fishing')
  AND g.provider_short IN ('JILI','FC','FG','568W','CQ9','JDB','YGG','PG','BNG','HS','KA','NLC','5G','FS','NG')
  AND g.rtp BETWEEN 0.85 AND 0.97;

-- 2% 档：RTP≤0.95 热度前 5
INSERT INTO bg_rebate_featured_game (game_uuid, tier, sort_order, enabled)
SELECT uuid, 'elite', ROW_NUMBER() OVER (ORDER BY weight DESC, game_id) * 10, 1
FROM tmp_cashback_pool WHERE rtp <= 0.95
ORDER BY weight DESC, game_id LIMIT 5;

-- 1.5% 档：RTP≤0.96 热度前 20（排除已入 2% 档）
INSERT INTO bg_rebate_featured_game (game_uuid, tier, sort_order, enabled)
SELECT uuid, 'pro', ROW_NUMBER() OVER (ORDER BY weight DESC, game_id) * 10, 1
FROM tmp_cashback_pool
WHERE rtp <= 0.96 AND uuid NOT IN (SELECT game_uuid FROM bg_rebate_featured_game)
ORDER BY weight DESC, game_id LIMIT 20;

-- 1% 档：RTP≤0.97 热度前 100（排除已入 2%/1.5% 档）
INSERT INTO bg_rebate_featured_game (game_uuid, tier, sort_order, enabled)
SELECT uuid, 'basic', ROW_NUMBER() OVER (ORDER BY weight DESC, game_id) * 10, 1
FROM tmp_cashback_pool
WHERE rtp <= 0.97 AND uuid NOT IN (SELECT game_uuid FROM bg_rebate_featured_game)
ORDER BY weight DESC, game_id LIMIT 100;

DROP TEMPORARY TABLE IF EXISTS tmp_cashback_pool;

-- 验证
SELECT tier, COUNT(*) n, ROUND(AVG(g.rtp),4) avg_rtp, ROUND(MAX(g.rtp),4) max_rtp FROM bg_rebate_featured_game f
  JOIN bg_568win_game g ON CONCAT('568win:',g.game_provider_id,':',g.game_id)=f.game_uuid
  GROUP BY tier ORDER BY FIELD(tier,'elite','pro','basic');
