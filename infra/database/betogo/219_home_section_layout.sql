-- 首页装修：在原「板块显示/隐藏」表上扩出「排序 + 每块参数」，构成区块化配置的最小结构。
-- 表名沿用 bg_homepage_section_visibility（不改名）：改名要同步基线与 3 处调用点，
-- 且代码若先于迁移上线就会整块报错，收益只是名字更贴切，不值当。
--
-- section_key 从原来的 12 个游戏板块扩到含运营板块（banner/公告/最近在玩/活动横条/
-- 厂商专区/投注榜），这些块此前完全不可配。无行 = 显示 + 用代码默认顺序，故不需要种子数据。
ALTER TABLE bg_homepage_section_visibility
  ADD COLUMN sort_order INT NOT NULL DEFAULT 0 COMMENT '首页渲染顺序，小的在前；同值按代码默认顺序',
  ADD COLUMN params JSON NULL COMMENT '每块参数：{"limit":12,"layout":"big"}，null=用默认';
