-- 负盈利返水（路线A·CasinoPlus 式）：每日结算、统一费率、全等级、无上限；品类白名单+门槛+封顶当日存款
-- 配置存 bg_promo_config(promo_id='loss_rebate')；结算引擎见 vip.service.ts runDailyLossRebate
-- 品类白名单复用 bg_turnover_logs.sort_category（与洗码同源），不新建映射表
-- VIP 等级差异化返水 bg_vip_level_benefit.negative_rebate_pct 已降格停用，字段保留可回滚

-- 默认配置：默认关闭（enabled=0），后台开启后每日生效
INSERT IGNORE INTO `bg_promo_config` (`promo_id`, `config_key`, `config_value`) VALUES
  ('loss_rebate', 'enabled',        '0'),
  ('loss_rebate', 'rate_pct',       '5'),
  ('loss_rebate', 'min_deposit',    '50'),
  ('loss_rebate', 'cap_to_deposit', '1'),
  ('loss_rebate', 'eligible_cats',  'slots,fishing');

-- 结算 SQL 按 (user_id, round_id) 关联 win/refund 到其 bet 定品类；补索引避免全表扫
CREATE INDEX `idx_bet_user_round` ON `bg_bet_order` (`user_id`, `round_id`);
