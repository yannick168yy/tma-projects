-- 清理无用表：一次性，schema_migrations 保证本文件只执行一次；全部 DROP TABLE IF EXISTS，生产上无对应表则为 no-op。
-- 均非业务数据表：①两张运行时零引用的孤儿 schema 表 ②运营改配置前留下的手动备份快照（*_bak_*）。

-- ① 死表：运行时代码从不读写（仅 094/105 建表迁移引用过）
DROP TABLE IF EXISTS bg_game_aggregator;        -- 094 建，聚合商配置表；568win 写死、slotegrator 已退役(137)，运行时不读
DROP TABLE IF EXISTS bg_gemini_search_quota;    -- 105 建，Gemini 搜图配额表，从未接线，空表

-- ② 手动备份快照（2026-07-12/13 运营配置改动前的安全备份，仅测试库存在）
DROP TABLE IF EXISTS bg_568win_game_override_bak_20260712;
DROP TABLE IF EXISTS bg_admin_settings_bak_20260712;
DROP TABLE IF EXISTS bg_admin_settings_taskcfg_bak_20260713;
DROP TABLE IF EXISTS bg_firstdep_tiers_bak_20260712;
DROP TABLE IF EXISTS bg_promo_config_bak_20260712;
DROP TABLE IF EXISTS bg_promo_config_bak_20260713;
DROP TABLE IF EXISTS bg_rebate_featured_game_bak_20260712;
DROP TABLE IF EXISTS bg_rebate_level_config_bak_20260712;
DROP TABLE IF EXISTS bg_rebate_level_threshold_bak_20260713;
DROP TABLE IF EXISTS bg_spin_deposit_rule_bak_20260712;
DROP TABLE IF EXISTS bg_spin_prize_bak_20260712;
DROP TABLE IF EXISTS bg_spin_prize_bak_20260713;
DROP TABLE IF EXISTS bg_team_config_bak_20260712;
DROP TABLE IF EXISTS bg_team_rate_plan_bak_20260712;
DROP TABLE IF EXISTS bg_vip_level_benefit_bak_20260712;
DROP TABLE IF EXISTS bg_vip_level_benefit_bak_20260713;
DROP TABLE IF EXISTS bg_withdraw_review_config_bak_20260712;
