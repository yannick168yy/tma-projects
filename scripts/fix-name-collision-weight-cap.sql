-- 一次性数据修复：通用名撞厂商(provider_match=false)的竞品权重封顶 7000
-- 背景：竞品策略脚本按游戏名匹配，Funky Mines 等 43 款因同名蹭到跨厂商热度分(9995等)压过真爆款
-- 2026-07-12 已在测试库手动执行(43行)；生产上线时需重放
-- apply.ts 已同步加封顶规则，重跑竞品策略不会再写回虚高值
UPDATE bg_568win_game_override
SET weight = 7000
WHERE weight > 7000
  AND JSON_UNQUOTE(JSON_EXTRACT(weight_breakdown,'$.provider_match')) = 'false'
  AND JSON_UNQUOTE(JSON_EXTRACT(weight_breakdown,'$.source')) = 'competitor';
