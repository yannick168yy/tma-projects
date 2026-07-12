-- ═══════════════════════════════════════════════════════════════════════════
-- 运营数据配置 v1（2026-07-12 运营总监方案,用户已拍板）
-- ⚠️ 手动执行,不进自动部署迁移。执行方式:
--   podman exec -i tma-mysql mysql -ubetogo -ptma_dev betogo < seed-operational-config-v1.sql
--
-- 经济模型锚点:电子每₱100有效流水净毛利≈₱3.4(GGR4% − 分成7.5% − 支付~0.25),
-- 全部优惠叠加红线 ≤ 流水的1.5%(≈净GGR的40-45%)。
-- 拍板项:佣金 0.35/0.10/0.05(流水基数);首充适度提高、打码10x;周俸月俸砍半。
-- ═══════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;

-- ── 0. 备份(幂等,重复执行不覆盖已有备份) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS bg_team_config_bak_20260712            AS SELECT * FROM bg_team_config;
CREATE TABLE IF NOT EXISTS bg_team_rate_plan_bak_20260712         AS SELECT * FROM bg_team_rate_plan;
CREATE TABLE IF NOT EXISTS bg_rebate_level_config_bak_20260712    AS SELECT * FROM bg_rebate_level_config;
CREATE TABLE IF NOT EXISTS bg_vip_level_benefit_bak_20260712      AS SELECT * FROM bg_vip_level_benefit;
CREATE TABLE IF NOT EXISTS bg_promo_config_bak_20260712           AS SELECT * FROM bg_promo_config;
CREATE TABLE IF NOT EXISTS bg_firstdep_tiers_bak_20260712         AS SELECT * FROM bg_firstdep_tiers;
CREATE TABLE IF NOT EXISTS bg_spin_prize_bak_20260712             AS SELECT * FROM bg_spin_prize;
CREATE TABLE IF NOT EXISTS bg_spin_deposit_rule_bak_20260712      AS SELECT * FROM bg_spin_deposit_rule;
CREATE TABLE IF NOT EXISTS bg_withdraw_review_config_bak_20260712 AS SELECT * FROM bg_withdraw_review_config;
CREATE TABLE IF NOT EXISTS bg_admin_settings_bak_20260712         AS SELECT * FROM bg_admin_settings;
CREATE TABLE IF NOT EXISTS bg_rebate_featured_game_bak_20260712   AS SELECT * FROM bg_rebate_featured_game;

-- ── 1. 分销佣金:1.1%流水→0.5%(L1 0.35/L2 0.10/L3 0.05),VIP+方案 L1 0.50 ──
-- 单期佣金封顶 ₱50,000;团队钱包最低提现 ₱20→₱100(代付成本4.3/笔)
UPDATE bg_team_config SET
  l1_rate_pct = 0.35, l2_rate_pct = 0.10, l3_rate_pct = 0.05,
  max_commission_per_settlement_cents = 5000000,
  min_withdrawal_cents = 10000
WHERE id = 1;
UPDATE bg_team_rate_plan SET l1_rate_pct = 0.35, l2_rate_pct = 0.10, l3_rate_pct = 0.05 WHERE is_default = 1;
UPDATE bg_team_rate_plan SET l1_rate_pct = 0.50, l2_rate_pct = 0.10, l3_rate_pct = 0.05 WHERE name = 'VIP+';

-- ── 2. 洗码费率:按品类净毛利分三档阶梯(现值 LV1 就 0.3-0.8 过松,live 0.8 会被百家乐平注套利) ──
-- slots/fishing(净毛利~3.4): 0.20→1.00
UPDATE bg_rebate_level_config SET rate_pct = CASE level
  WHEN 1 THEN 0.200 WHEN 2 THEN 0.250 WHEN 3 THEN 0.300 WHEN 4 THEN 0.400 WHEN 5 THEN 0.500
  WHEN 6 THEN 0.600 WHEN 7 THEN 0.700 WHEN 8 THEN 0.850 WHEN 9 THEN 1.000 END
WHERE game_category IN ('slots','fishing');
-- table/bingo/pinoy/crash/other(净毛利~2.6): 0.15→0.80
UPDATE bg_rebate_level_config SET rate_pct = CASE level
  WHEN 1 THEN 0.150 WHEN 2 THEN 0.200 WHEN 3 THEN 0.250 WHEN 4 THEN 0.300 WHEN 5 THEN 0.350
  WHEN 6 THEN 0.450 WHEN 7 THEN 0.550 WHEN 8 THEN 0.650 WHEN 9 THEN 0.800 END
WHERE game_category IN ('table','bingo','pinoy','crash','other');
-- live/sports(百家乐庄边仅1.06%流水/体育分成10-13%): 0.10→0.40 封顶
UPDATE bg_rebate_level_config SET rate_pct = CASE level
  WHEN 1 THEN 0.100 WHEN 2 THEN 0.120 WHEN 3 THEN 0.150 WHEN 4 THEN 0.180 WHEN 5 THEN 0.220
  WHEN 6 THEN 0.260 WHEN 7 THEN 0.300 WHEN 8 THEN 0.350 WHEN 9 THEN 0.400 END
WHERE game_category IN ('live','sports');

-- ── 3. VIP 权益:周俸/月俸砍半(现发放门槛仅"当期有投注",防躺领;根治=后续加周流水门槛) ──
-- 晋级礼金/生日礼金/负盈利返水/保级线不动;补上每日提现额度与次数(纯展示,未接闸门)
UPDATE bg_vip_level_benefit SET weekly_salary=0,   monthly_salary=0,    withdraw_daily_limit=20000,   withdraw_daily_count=2  WHERE level=1;
UPDATE bg_vip_level_benefit SET weekly_salary=1,   monthly_salary=3,    withdraw_daily_limit=30000,   withdraw_daily_count=2  WHERE level=2;
UPDATE bg_vip_level_benefit SET weekly_salary=2,   monthly_salary=8,    withdraw_daily_limit=50000,   withdraw_daily_count=3  WHERE level=3;
UPDATE bg_vip_level_benefit SET weekly_salary=4,   monthly_salary=20,   withdraw_daily_limit=80000,   withdraw_daily_count=3  WHERE level=4;
UPDATE bg_vip_level_benefit SET weekly_salary=10,  monthly_salary=50,   withdraw_daily_limit=120000,  withdraw_daily_count=5  WHERE level=5;
UPDATE bg_vip_level_benefit SET weekly_salary=25,  monthly_salary=130,  withdraw_daily_limit=200000,  withdraw_daily_count=8  WHERE level=6;
UPDATE bg_vip_level_benefit SET weekly_salary=65,  monthly_salary=350,  withdraw_daily_limit=350000,  withdraw_daily_count=12 WHERE level=7;
UPDATE bg_vip_level_benefit SET weekly_salary=175, monthly_salary=900,  withdraw_daily_limit=600000,  withdraw_daily_count=20 WHERE level=8;
UPDATE bg_vip_level_benefit SET weekly_salary=500, monthly_salary=2500, withdraw_daily_limit=1000000, withdraw_daily_count=30 WHERE level=9;

-- ── 4. 首充嘉年华:奖励适度提高(头部30-40%),打码 1x→10x(原1x等于白送,严重漏洞) ──
UPDATE bg_promo_config SET config_value = '10' WHERE promo_id = 'firstdep' AND config_key = 'turnover_x';
DELETE FROM bg_firstdep_tiers;
INSERT INTO bg_firstdep_tiers (currency, deposit_amount, bonus_amount) VALUES
  ('PHP',    20,    8), ('PHP',    50,   15), ('PHP',   100,   40), ('PHP',  200,  70),
  ('PHP',   500,  150), ('PHP',  1000,  250), ('PHP',  2000,  450), ('PHP', 5000, 900),
  ('PHP', 10000, 1500), ('PHP', 50000, 4000),
  ('USDT',  1, 0.3), ('USDT',  5, 1.2), ('USDT', 10, 3), ('USDT', 50, 12),
  ('USDT', 100, 25), ('USDT', 500, 80), ('USDT', 1000, 150),
  ('USDC',  1, 0.3), ('USDC',  5, 1.2), ('USDC', 10, 3), ('USDC', 50, 12),
  ('USDC', 100, 25), ('USDC', 500, 80), ('USDC', 1000, 150);

-- ── 5. 邀请共赢:50+30→25+10(被邀人已享首充40%,且与任务里程碑叠发,80/人补贴过高) ──
UPDATE bg_promo_config SET config_value = '25' WHERE promo_id = 'referral' AND config_key = 'inviter_amount';
UPDATE bg_promo_config SET config_value = '10' WHERE promo_id = 'referral' AND config_key = 'invitee_amount';

-- ── 6. 任务配置:仅改 invite_milestone(邀2人₱20 3x → 邀3人₱10 5x,与 referral 去重叠) ──
UPDATE bg_admin_settings SET `value` = '{"daily_deposit_t1":{"enabled":true,"rewardType":"spin","amount":0,"spin":1,"turnoverX":0,"currency":"PHP","threshold":100,"minStake":0,"category":""},"daily_deposit_t2":{"enabled":true,"rewardType":"cash","amount":10,"spin":0,"turnoverX":3,"currency":"PHP","threshold":500,"minStake":0,"category":""},"daily_deposit_t3":{"enabled":true,"rewardType":"cash","amount":30,"spin":0,"turnoverX":3,"currency":"PHP","threshold":2000,"minStake":0,"category":""},"daily_bets":{"enabled":true,"rewardType":"spin","amount":0,"spin":1,"turnoverX":0,"currency":"PHP","threshold":5,"minStake":10,"category":""},"daily_play":{"enabled":true,"rewardType":"spin","amount":0,"spin":1,"turnoverX":0,"currency":"PHP","threshold":1,"minStake":0,"category":"slot"},"profile_complete":{"enabled":true,"rewardType":"cash","amount":5,"spin":0,"turnoverX":3,"currency":"PHP","threshold":0,"minStake":0,"category":""},"first_game":{"enabled":true,"rewardType":"cash","amount":5,"spin":0,"turnoverX":3,"currency":"PHP","threshold":0,"minStake":0,"category":""},"invite_milestone":{"enabled":true,"rewardType":"cash","amount":10,"spin":0,"turnoverX":5,"currency":"PHP","threshold":3,"minStake":0,"category":""}}'
WHERE `key` = 'task_config';

-- ── 7. 签到配置:仅改30天里程碑 3→2 次 elite 转盘(全勤月成本 ~₱215→₱190) ──
UPDATE bg_admin_settings SET `value` = '{"enabled":true,"enhancedMinPhp":100,"cycle":[{"base":{"tier":"starter","n":1},"enh":{"tier":"premium","n":1}},{"base":{"tier":"starter","n":1},"enh":{"tier":"premium","n":1}},{"base":{"tier":"starter","n":1},"enh":{"tier":"premium","n":1}},{"base":{"tier":"starter","n":1},"enh":{"tier":"premium","n":1}},{"base":{"tier":"starter","n":1},"enh":{"tier":"premium","n":1}},{"base":{"tier":"starter","n":1},"enh":{"tier":"premium","n":1}},{"base":{"tier":"premium","n":1},"enh":{"tier":"elite","n":1}}],"milestones":[{"atDays":7,"tier":"premium","n":1},{"atDays":15,"tier":"elite","n":1},{"atDays":30,"tier":"elite","n":2}]}'
WHERE `key` = 'checkin_config';

-- ── 8. 转盘:整体重做。旧奖池 starter 轮 EV≈₱427/次、elite≈₱4400/次(测试残留,上线即被薅穿) ──
-- 新 EV:充值轮 100/500/1000/2000/5000/10000 → 3.8/8.4/14.7/22.4/55.5/106(≈档位额1-4%,递减)
--        签到轮 starter/premium/elite → 3.8/12.1/26.7;大奖仍留盘面做噱头但权重 1/10000
-- bg_spin_record.prize_id 对奖品行有外键,旧奖品不能物理删除:置 enabled=0 停用保留,新奖池另行插入
UPDATE bg_spin_deposit_rule SET min_deposit_php = 100,  name = 'Deposit 100'  WHERE id = 1;
UPDATE bg_spin_deposit_rule SET min_deposit_php = 500,  name = 'Deposit 500'  WHERE id = 2;
UPDATE bg_spin_deposit_rule SET min_deposit_php = 1000, name = 'Deposit 1000' WHERE id = 3;

UPDATE bg_spin_prize SET enabled = 0 WHERE enabled = 1 AND id <= 88;  -- 88=旧奖池最大id,防重跑误停新奖池
INSERT INTO bg_spin_prize (rule_id,name,image_key,amount_php,weight,turnover_x,enabled,sort_order) VALUES
(1,'₱1.77','prize-1',1.77,7090,5.00,1,10),
(1,'₱2.77','prize-2',2.77,2000,5.00,1,20),
(1,'₱7.77','prize-3',7.77,700,8.00,1,30),
(1,'₱17.77','prize-4',17.77,180,8.00,1,40),
(1,'₱77.77','prize-5',77.77,20,10.00,1,50),
(1,'₱177.77','prize-6',177.77,8,10.00,1,60),
(1,'₱777.77','prize-7',777.77,1,15.00,1,70),
(1,'₱7,777','prize-8',7777.00,1,20.00,1,80),
(2,'₱1.77','prize-1',1.77,5054,5.00,1,10),
(2,'₱2.77','prize-2',2.77,2200,5.00,1,20),
(2,'₱7.77','prize-3',7.77,1800,8.00,1,30),
(2,'₱17.77','prize-4',17.77,700,8.00,1,40),
(2,'₱77.77','prize-5',77.77,180,10.00,1,50),
(2,'₱177.77','prize-6',177.77,50,10.00,1,60),
(2,'₱777.77','prize-7',777.77,15,15.00,1,70),
(2,'₱7,777','prize-8',7777.00,1,20.00,1,80),
(3,'₱2.77','prize-1',2.77,5200,5.00,1,10),
(3,'₱7.77','prize-2',7.77,2600,8.00,1,20),
(3,'₱17.77','prize-3',17.77,1700,8.00,1,30),
(3,'₱77.77','prize-4',77.77,400,10.00,1,40),
(3,'₱177.77','prize-5',177.77,80,10.00,1,50),
(3,'₱777.77','prize-6',777.77,15,15.00,1,60),
(3,'₱1,777','prize-7',1777.00,4,15.00,1,70),
(3,'₱17,777','prize-8',17777.00,1,20.00,1,80),
(4,'₱2.77','prize-1',2.77,3911,5.00,1,10),
(4,'₱7.77','prize-2',7.77,2800,8.00,1,20),
(4,'₱17.77','prize-3',17.77,2200,8.00,1,30),
(4,'₱77.77','prize-4',77.77,900,10.00,1,40),
(4,'₱177.77','prize-5',177.77,150,10.00,1,50),
(4,'₱777.77','prize-6',777.77,30,15.00,1,60),
(4,'₱1,777','prize-7',1777.00,8,15.00,1,70),
(4,'₱17,777','prize-8',17777.00,1,20.00,1,80),
(5,'₱7.77','prize-1',7.77,3964,8.00,1,10),
(5,'₱17.77','prize-2',17.77,3200,8.00,1,20),
(5,'₱77.77','prize-3',77.77,2000,10.00,1,30),
(5,'₱177.77','prize-4',177.77,700,10.00,1,40),
(5,'₱777.77','prize-5',777.77,100,15.00,1,50),
(5,'₱1,777','prize-6',1777.00,30,15.00,1,60),
(5,'₱7,777','prize-7',7777.00,5,20.00,1,70),
(5,'₱17,777','prize-8',17777.00,1,20.00,1,80),
(6,'₱17.77','prize-1',17.77,5804,8.00,1,10),
(6,'₱77.77','prize-2',77.77,2800,10.00,1,20),
(6,'₱177.77','prize-3',177.77,1000,10.00,1,30),
(6,'₱777.77','prize-4',777.77,300,15.00,1,40),
(6,'₱1,777','prize-5',1777.00,60,15.00,1,50),
(6,'₱2,777','prize-6',2777.00,25,15.00,1,60),
(6,'₱7,777','prize-7',7777.00,10,20.00,1,70),
(6,'₱77,777','prize-8',77777.00,1,20.00,1,80),
(7,'₱1.77','prize-1',1.77,7090,5.00,1,10),
(7,'₱2.77','prize-2',2.77,2000,5.00,1,20),
(7,'₱7.77','prize-3',7.77,700,8.00,1,30),
(7,'₱17.77','prize-4',17.77,180,8.00,1,40),
(7,'₱77.77','prize-5',77.77,20,10.00,1,50),
(7,'₱177.77','prize-6',177.77,8,10.00,1,60),
(7,'₱777.77','prize-7',777.77,1,15.00,1,70),
(7,'₱7,777','prize-8',7777.00,1,20.00,1,80),
(8,'₱2.77','prize-1',2.77,5909,5.00,1,10),
(8,'₱7.77','prize-2',7.77,2500,8.00,1,20),
(8,'₱17.77','prize-3',17.77,1200,8.00,1,30),
(8,'₱77.77','prize-4',77.77,300,10.00,1,40),
(8,'₱177.77','prize-5',177.77,70,10.00,1,50),
(8,'₱777.77','prize-6',777.77,15,15.00,1,60),
(8,'₱1,777','prize-7',1777.00,5,15.00,1,70),
(8,'₱7,777','prize-8',7777.00,1,20.00,1,80),
(9,'₱7.77','prize-1',7.77,6064,8.00,1,10),
(9,'₱17.77','prize-2',17.77,2800,8.00,1,20),
(9,'₱77.77','prize-3',77.77,900,10.00,1,30),
(9,'₱177.77','prize-4',177.77,200,10.00,1,40),
(9,'₱777.77','prize-5',777.77,20,15.00,1,50),
(9,'₱1,777','prize-6',1777.00,10,15.00,1,60),
(9,'₱2,777','prize-7',2777.00,5,15.00,1,70),
(9,'₱17,777','prize-8',17777.00,1,20.00,1,80);

-- ── 9. 取款审核:阈值按大站配的过松,新站收紧;same_ip_device ip=9999 等于关闭,恢复 ──
UPDATE bg_withdraw_review_config SET params = '{"usdt": 200, "phpCents": 1000000}' WHERE scope='user' AND rule_code='large_amount';
UPDATE bg_withdraw_review_config SET threshold = 5    WHERE scope='user' AND rule_code='high_multiple_profit';
UPDATE bg_withdraw_review_config SET threshold = 8    WHERE scope='user' AND rule_code='high_multiple_profit_24h';
UPDATE bg_withdraw_review_config SET threshold = 2000000 WHERE scope='user' AND rule_code='large_profit';
UPDATE bg_withdraw_review_config SET threshold = 200000  WHERE scope='user' AND rule_code='total_bonus';
UPDATE bg_withdraw_review_config SET params = '{"ip": 5, "device": 3}' WHERE scope='user' AND rule_code='same_ip_device';
UPDATE bg_withdraw_review_config SET params = '{"phpCents": 1000000}' WHERE scope='team' AND rule_code='large_amount';

-- ── 10. Cashback 精选游戏(纯展示):只放分成≤7.5%的电子爆款(JILI 7.5%/FaChai 7%),替换 PG(Pinata Wins) ──
DELETE FROM bg_rebate_featured_game;
INSERT INTO bg_rebate_featured_game (game_uuid, tier, sort_order, enabled) VALUES
  ('568win:1020:31',  'elite', 10, 1),  -- Super Ace (JILI)
  ('568win:1020:42',  'elite', 20, 1),  -- Fortune Gems (JILI)
  ('568win:1020:90',  'elite', 30, 1),  -- Color Game (JILI)
  ('568win:1046:54',  'elite', 40, 1),  -- Sugar Bang Bang 2 (FaChai)
  ('568win:1020:35',  'pro',   50, 1),  -- Boxing King (JILI)
  ('568win:1020:49',  'pro',   60, 1),  -- Mega Ace (JILI)
  ('568win:1020:41',  'pro',   70, 1),  -- Golden Empire (JILI)
  ('568win:1046:5',   'pro',   80, 1);  -- Lucky Fortunes (FaChai)

-- ── 验证 ────────────────────────────────────────────────────────────────────
SELECT 'team' AS section, l1_rate_pct, l2_rate_pct, l3_rate_pct, min_withdrawal_cents, max_commission_per_settlement_cents FROM bg_team_config;
SELECT 'rebate' AS section, game_category, GROUP_CONCAT(rate_pct ORDER BY level) rates FROM bg_rebate_level_config GROUP BY game_category;
SELECT 'vip' AS section, level, weekly_salary, monthly_salary, withdraw_daily_limit, withdraw_daily_count FROM bg_vip_level_benefit ORDER BY level;
SELECT 'spin_ev' AS section, rule_id, ROUND(SUM(amount_php*weight)/SUM(weight),2) ev, SUM(weight) w FROM bg_spin_prize GROUP BY rule_id;
SELECT 'firstdep' AS section, deposit_amount, bonus_amount FROM bg_firstdep_tiers WHERE currency='PHP' ORDER BY deposit_amount;
SELECT 'promo' AS section, promo_id, config_key, config_value FROM bg_promo_config WHERE (promo_id='firstdep' AND config_key='turnover_x') OR (promo_id='referral' AND config_key LIKE '%_amount');
SELECT 'review' AS section, scope, rule_code, threshold, params FROM bg_withdraw_review_config WHERE rule_code IN ('large_amount','high_multiple_profit','high_multiple_profit_24h','large_profit','total_bonus','same_ip_device');
SELECT 'featured' AS section, game_uuid, tier FROM bg_rebate_featured_game ORDER BY sort_order;
