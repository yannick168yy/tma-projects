-- 多币种(USDT/USDC)配置营销数值填充 v1
-- 手动执行脚本（不进迁移文件，按 CLAUDE.md 数据调整规则）；生产重放同样手动跑。
-- 规则：USDT/USDC ≈ PHP÷58，再配营销数值(0.88/0.77/8-尾等)，不合适则精确到1位小数。
-- USDT 与 USDC 取同一套值(≈1:1 USD)。百分比/次数类币种无关，不动。
-- 执行前自动备份到 *_bak_20260713。

SET NAMES utf8mb4;

-- ───────── 备份 ─────────
CREATE TABLE IF NOT EXISTS bg_rebate_level_threshold_bak_20260713 AS SELECT * FROM bg_rebate_level_threshold WHERE currency IN ('USDT','USDC');
CREATE TABLE IF NOT EXISTS bg_vip_level_benefit_bak_20260713 AS SELECT * FROM bg_vip_level_benefit WHERE currency IN ('USDT','USDC');
CREATE TABLE IF NOT EXISTS bg_spin_prize_bak_20260713 AS SELECT * FROM bg_spin_prize WHERE currency IN ('USDT','USDC');
CREATE TABLE IF NOT EXISTS bg_promo_config_bak_20260713 AS SELECT * FROM bg_promo_config WHERE config_key LIKE '%usdt%' OR config_key LIKE '%usdc%';
CREATE TABLE IF NOT EXISTS bg_admin_settings_taskcfg_bak_20260713 AS SELECT * FROM bg_admin_settings WHERE `key`='task_config';

-- ───────── 1. VIP 等级阈值 bg_rebate_level_threshold (USDT & USDC) ─────────
-- PHP: 0/1000/5000/20000/60000/150000/400000/1000000/3000000
INSERT INTO bg_rebate_level_threshold (level, currency, min_turnover) VALUES
  (1,'USDT',0),(2,'USDT',18),(3,'USDT',88),(4,'USDT',388),(5,'USDT',1088),(6,'USDT',2588),(7,'USDT',6888),(8,'USDT',17888),(9,'USDT',51888),
  (1,'USDC',0),(2,'USDC',18),(3,'USDC',88),(4,'USDC',388),(5,'USDC',1088),(6,'USDC',2588),(7,'USDC',6888),(8,'USDC',17888),(9,'USDC',51888)
ON DUPLICATE KEY UPDATE min_turnover=VALUES(min_turnover);

-- ───────── 2. VIP 权益 bg_vip_level_benefit (USDT & USDC) ─────────
-- 金额列按营销值；negative_rebate_pct(%) 与 withdraw_daily_count(次数) 币种无关，此处一并按 PHP 复制保持一致
INSERT INTO bg_vip_level_benefit
  (level, currency, promotion_bonus, weekly_salary, monthly_salary, birthday_bonus, negative_rebate_pct, retention_line, withdraw_daily_limit, withdraw_daily_count)
SELECT p.level, c.cur,
  ELT(p.level, 0,0.1,0.3,0.88,2.88,6.88,17.88,48.88,138.88),
  ELT(p.level, 0,0.02,0.05,0.08,0.2,0.5,1.1,3,8.88),
  ELT(p.level, 0,0.08,0.15,0.3,0.88,2.2,5.88,15.88,43.88),
  ELT(p.level, 0.1,0.1,0.2,0.3,0.88,1.88,3.5,5.88,8.88),
  p.negative_rebate_pct,
  ELT(p.level, 0,8.8,38.8,138,438,1088,2788,6888,20888),
  ELT(p.level, 388,588,888,1388,2088,3488,5988,10388,17888),
  p.withdraw_daily_count
FROM bg_vip_level_benefit p
CROSS JOIN (SELECT 'USDT' AS cur UNION ALL SELECT 'USDC') c
WHERE p.currency='PHP'
ON DUPLICATE KEY UPDATE
  promotion_bonus=VALUES(promotion_bonus), weekly_salary=VALUES(weekly_salary), monthly_salary=VALUES(monthly_salary),
  birthday_bonus=VALUES(birthday_bonus), retention_line=VALUES(retention_line), withdraw_daily_limit=VALUES(withdraw_daily_limit);

-- ───────── 3. 复充 redep + 负盈利返水 loss_rebate (USDT & USDC) ─────────
-- redep: PHP min 500/bonus 75 → USDT min 8.8 / bonus 1.3 (匹配率≈15%)；loss_rebate: PHP 50 → 0.88
UPDATE bg_promo_config SET config_value='8.8' WHERE promo_id='redep' AND config_key IN ('min_deposit_usdt','min_deposit_usdc');
UPDATE bg_promo_config SET config_value='1.3' WHERE promo_id='redep' AND config_key IN ('bonus_amount_usdt','bonus_amount_usdc');
UPDATE bg_promo_config SET config_value='0.88' WHERE promo_id='loss_rebate' AND config_key IN ('min_deposit_usdt','min_deposit_usdc');

-- ───────── 4. 转盘奖池 bg_spin_prize (USDT & USDC) ─────────
-- 小额高权重奖品保持 ÷58(护 EV)，中大奖营销化。按 PHP 奖品重建 USDT/USDC(此前无 USDT/USDC 派奖记录，安全)
DELETE FROM bg_spin_prize WHERE currency IN ('USDT','USDC');
INSERT INTO bg_spin_prize (rule_id, currency, name, image_key, amount_php, weight, turnover_x, enabled, sort_order)
SELECT p.rule_id, c.cur,
  CONCAT(m.amt, ' ', c.cur), p.image_key, m.amt, p.weight, p.turnover_x, p.enabled, p.sort_order
FROM bg_spin_prize p
JOIN (
  SELECT 1.77 php, 0.03 amt UNION ALL SELECT 2.77,0.05 UNION ALL SELECT 7.77,0.13 UNION ALL SELECT 17.77,0.3
  UNION ALL SELECT 77.77,1.3 UNION ALL SELECT 177.77,3 UNION ALL SELECT 277.77,4.8 UNION ALL SELECT 777.77,13
  UNION ALL SELECT 1777,30 UNION ALL SELECT 2777,48 UNION ALL SELECT 7777,138 UNION ALL SELECT 17777,288
  UNION ALL SELECT 27777,488 UNION ALL SELECT 77777,1388 UNION ALL SELECT 177777,3088
) m ON ABS(p.amount_php - m.php) < 0.005
CROSS JOIN (SELECT 'USDT' AS cur UNION ALL SELECT 'USDC') c
WHERE p.currency='PHP';

-- ───────── 5. 任务体系 task_config 嵌套 per-currency (USDT & USDC 每日任务营销值) ─────────
-- 把当前扁平(PHP)包成 {PHP,USDT,USDC}；USDT/USDC 只存留存类每日任务(拉新任务固定 PHP，缺省回落默认)。
-- 每日存款门槛 t1/t2/t3: 100/500/2000→1.8/8.8/34.8；现金奖励 10/30→0.2/0.5；daily_bets minStake 10→0.2；次数型不变。
-- 幂等守卫：仅当尚未嵌套(无 $.PHP 键)时执行，避免重复包裹。
UPDATE bg_admin_settings
SET `value` = JSON_OBJECT(
  'PHP', CAST(`value` AS JSON),
  'USDT', CAST('{"daily_deposit_t1":{"enabled":true,"rewardType":"spin","amount":0,"spin":1,"turnoverX":0,"currency":"USDT","threshold":1.8,"minStake":0,"category":""},"daily_deposit_t2":{"enabled":true,"rewardType":"cash","amount":0.2,"spin":0,"turnoverX":3,"currency":"USDT","threshold":8.8,"minStake":0,"category":""},"daily_deposit_t3":{"enabled":true,"rewardType":"cash","amount":0.5,"spin":0,"turnoverX":3,"currency":"USDT","threshold":34.8,"minStake":0,"category":""},"daily_bets":{"enabled":true,"rewardType":"spin","amount":0,"spin":1,"turnoverX":0,"currency":"USDT","threshold":5,"minStake":0.2,"category":""},"daily_play":{"enabled":true,"rewardType":"spin","amount":0,"spin":1,"turnoverX":0,"currency":"USDT","threshold":1,"minStake":0,"category":"slot"}}' AS JSON),
  'USDC', CAST('{"daily_deposit_t1":{"enabled":true,"rewardType":"spin","amount":0,"spin":1,"turnoverX":0,"currency":"USDC","threshold":1.8,"minStake":0,"category":""},"daily_deposit_t2":{"enabled":true,"rewardType":"cash","amount":0.2,"spin":0,"turnoverX":3,"currency":"USDC","threshold":8.8,"minStake":0,"category":""},"daily_deposit_t3":{"enabled":true,"rewardType":"cash","amount":0.5,"spin":0,"turnoverX":3,"currency":"USDC","threshold":34.8,"minStake":0,"category":""},"daily_bets":{"enabled":true,"rewardType":"spin","amount":0,"spin":1,"turnoverX":0,"currency":"USDC","threshold":5,"minStake":0.2,"category":""},"daily_play":{"enabled":true,"rewardType":"spin","amount":0,"spin":1,"turnoverX":0,"currency":"USDC","threshold":1,"minStake":0,"category":"slot"}}' AS JSON)
)
WHERE `key`='task_config' AND JSON_VALID(`value`) AND JSON_EXTRACT(`value`, '$.PHP') IS NULL;

