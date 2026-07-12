-- Cashback Games 选品 v3：三档 2%/1.5%/1%（2026-07-12，手动执行,不进自动部署迁移）
--
-- ⚠️ 重要:精选档位是**真实结算费率**,不是纯展示——rebate.service SQL_EFFECTIVE_RATE_PCT
--    在洗码结算时 JOIN bg_rebate_featured_game,精选游戏按档位费率覆盖分级大类费率。
--    故选品严守盈亏:三档全部只放 RTP≤0.96(hold≥4%)的白名单厂商(分成≤7.5%)爆款。
--
-- 盈亏(每100流水,RTP96%→GGR4%,分成~0.3%,净毛利~3.7%):
--   2% 档:洗码2% 占净GGR 54% → 只给 ≤5 款顶流引流位
--   1.5%档:占净41% → ≤20 款
--   1%  档:占净27%(叠上级佣金0.5%后~41%) → ≤100 款,是走量主力
-- 白名单厂商:JILI 7.5/FC 7/FG 6/568W 6.5/CQ9 7/JDB 7/YGG 7/PG 7/BNG 7/HS 7.5/KA 7/NLC 7/5G 6/FS 6/NG 6
-- (排除 PP 8/PT 11/MG 8/HB 8/Apollo 9/AfricanBuffalo 12)

DELETE FROM bg_rebate_featured_game;

-- 白名单候选池按竞品热度权重降序编号,前 125 名切三档:1-5→elite / 6-25→pro / 26-125→basic
INSERT INTO bg_rebate_featured_game (game_uuid, tier, sort_order, enabled)
SELECT uuid,
       CASE WHEN rk <= 5 THEN 'elite' WHEN rk <= 25 THEN 'pro' ELSE 'basic' END AS tier,
       rk * 10 AS sort_order,
       1
FROM (
  SELECT CONCAT('568win:', g.game_provider_id, ':', g.game_id) AS uuid,
         ROW_NUMBER() OVER (ORDER BY o.weight DESC, g.game_id) AS rk
  FROM bg_568win_game g
  JOIN bg_568win_game_override o
    ON o.game_provider_id = g.game_provider_id AND o.game_id = g.game_id
  WHERE (o.is_active IS NULL OR o.is_active = 1)
    AND g.site_category_auto IN ('slot', 'fishing')
    AND g.provider_short IN ('JILI','FC','FG','568W','CQ9','JDB','YGG','PG','BNG','HS','KA','NLC','5G','FS','NG')
    AND g.rtp BETWEEN 0.85 AND 0.96
) ranked
WHERE rk <= 125;

-- 验证
SELECT tier, COUNT(*) n, ROUND(AVG(g.rtp),4) avg_rtp FROM bg_rebate_featured_game f
  JOIN bg_568win_game g ON CONCAT('568win:',g.game_provider_id,':',g.game_id)=f.game_uuid
  GROUP BY tier ORDER BY FIELD(tier,'elite','pro','basic');
