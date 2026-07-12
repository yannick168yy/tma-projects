-- Cashback Games 精选选品 v2（2026-07-12，手动执行,不进自动部署迁移）
--
-- 两档均为展示分组(不参与洗码结算),但按「若兑现也不亏」的口径选品:
--   elite(2%档,<5款):  RTP=96%(hold 4%) 的站内真爆款,分成≤7.5%厂商
--     → 4% − 分成~0.3 − 2% ≈ 1.7% 仍有空间;97%RTP爆款(Super Ace等)hold仅3%,不入围
--   pro(1.5%档,≤100款): 分成≤7.5%厂商 + RTP≤96% + 在架电子/捕鱼,按竞品热度权重降序取96款
--     → 4% − 0.3 − 1.5% ≈ 2.2%
-- 厂商白名单(568Win分成表): JILI 7.5/FC 7/FG 6/568W 6.5/CQ9 7/JDB 7/YGG 7/PG 7/
--   BNG 7/HS 7.5/KA 7/NLC 7/5G 6/FS 6/NG 6;排除 PP 8/PT 11/MG 8/HB 8/Apollo 9/AB 12

DELETE FROM bg_rebate_featured_game;

-- 2% 档(elite):热度 9500+ 且 RTP 96% 的爆款
INSERT INTO bg_rebate_featured_game (game_uuid, tier, sort_order, enabled) VALUES
  ('568win:2:84',     'elite', 10, 1),  -- Zeus (CQ9, rtp .96, weight 9925)
  ('568win:1058:77',  'elite', 20, 1),  -- Open Sesame (JDB, .96, 9865)
  ('568win:1046:69',  'elite', 30, 1),  -- Lucky Fortunes 3x3 (FaChai, .96, 9675)
  ('568win:1020:193', 'elite', 40, 1);  -- Money Coming 2 (JILI, .96, 9575)

-- 1.5% 档(pro):白名单厂商 + RTP≤96% + 在架,按权重降序 96 款
INSERT INTO bg_rebate_featured_game (game_uuid, tier, sort_order, enabled)
SELECT CONCAT('568win:', g.game_provider_id, ':', g.game_id), 'pro',
       100 + ROW_NUMBER() OVER (ORDER BY o.weight DESC), 1
FROM bg_568win_game g
JOIN bg_568win_game_override o
  ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id
WHERE (o.is_active IS NULL OR o.is_active = 1)
  AND g.site_category_auto IN ('slot', 'fishing')
  AND g.provider_short IN ('JILI','FC','FG','568W','CQ9','JDB','YGG','PG','BNG','HS','KA','NLC','5G','FS','NG')
  AND g.rtp BETWEEN 0.85 AND 0.9649
  AND CONCAT('568win:', g.game_provider_id, ':', g.game_id)
      NOT IN ('568win:2:84','568win:1058:77','568win:1046:69','568win:1020:193')
ORDER BY o.weight DESC
LIMIT 96;

-- 验证
SELECT tier, COUNT(*) FROM bg_rebate_featured_game GROUP BY tier;
