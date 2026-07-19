-- 125: 签到抽奖恢复三档独立奖池（starter/premium/elite）
-- 124 建的单一签到档 → 转为 starter；再补 premium/elite 两档，各 8 奖品。
-- 签到发放的转盘次数按 tier 进入对应档位；客户端签到页只显示 kind='checkin' 的三档。

ALTER TABLE `bg_spin_deposit_rule`
  ADD COLUMN `checkin_tier` ENUM('starter','premium','elite') NULL AFTER `kind`;

-- 既有单一签到档（124 创建）→ starter
UPDATE `bg_spin_deposit_rule`
   SET `checkin_tier` = 'starter', `name` = 'Check-in Starter', `sort_order` = 900
 WHERE `kind` = 'checkin' AND `checkin_tier` IS NULL;

-- premium 档
INSERT INTO `bg_spin_deposit_rule` (`kind`, `checkin_tier`, `name`, `min_deposit_php`, `max_deposit_php`, `chances`, `enabled`, `sort_order`)
SELECT 'checkin', 'premium', 'Check-in Premium', 0, NULL, 1, 1, 910
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `bg_spin_deposit_rule` WHERE `kind` = 'checkin' AND `checkin_tier` = 'premium');

-- elite 档
INSERT INTO `bg_spin_deposit_rule` (`kind`, `checkin_tier`, `name`, `min_deposit_php`, `max_deposit_php`, `chances`, `enabled`, `sort_order`)
SELECT 'checkin', 'elite', 'Check-in Elite', 0, NULL, 1, 1, 920
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM `bg_spin_deposit_rule` WHERE `kind` = 'checkin' AND `checkin_tier` = 'elite');

-- premium 档 8 奖品
INSERT INTO `bg_spin_prize` (`rule_id`, `name`, `image_key`, `amount_php`, `weight`, `turnover_x`, `enabled`, `sort_order`)
SELECT r.`id`, p.`name`, p.`image_key`, p.`amount_php`, p.`weight`, p.`turnover_x`, 1, p.`sort_order`
FROM `bg_spin_deposit_rule` r
JOIN (
  SELECT '₱17.77'   AS `name`, 'prize-1' AS `image_key`, 17.7700    AS `amount_php`, 3000 AS `weight`, 1.00 AS `turnover_x`, 10 AS `sort_order`
  UNION ALL SELECT '₱77.77',   'prize-2', 77.7700,    3000, 1.00, 20
  UNION ALL SELECT '₱277.77',  'prize-3', 277.7700,   800,  3.00, 30
  UNION ALL SELECT '₱777.77',  'prize-4', 777.7700,   800,  3.00, 40
  UNION ALL SELECT '₱1,777',   'prize-5', 1777.0000,  800,  3.00, 50
  UNION ALL SELECT '₱7,777',   'prize-6', 7777.0000,  100,  8.00, 60
  UNION ALL SELECT '₱17,777',  'prize-7', 17777.0000, 100,  8.00, 70
  UNION ALL SELECT '₱77,777',  'prize-8', 77777.0000, 100,  8.00, 80
) p
WHERE r.`kind` = 'checkin' AND r.`checkin_tier` = 'premium'
  AND NOT EXISTS (SELECT 1 FROM `bg_spin_prize` e WHERE e.`rule_id` = r.`id`);

-- elite 档 8 奖品
INSERT INTO `bg_spin_prize` (`rule_id`, `name`, `image_key`, `amount_php`, `weight`, `turnover_x`, `enabled`, `sort_order`)
SELECT r.`id`, p.`name`, p.`image_key`, p.`amount_php`, p.`weight`, p.`turnover_x`, 1, p.`sort_order`
FROM `bg_spin_deposit_rule` r
JOIN (
  SELECT '₱77.77'   AS `name`, 'prize-1' AS `image_key`, 77.7700     AS `amount_php`, 3000 AS `weight`, 1.00 AS `turnover_x`, 10 AS `sort_order`
  UNION ALL SELECT '₱277.77',  'prize-2', 277.7700,    3000, 1.00, 20
  UNION ALL SELECT '₱777.77',  'prize-3', 777.7700,    800,  3.00, 30
  UNION ALL SELECT '₱2,777',   'prize-4', 2777.0000,   800,  3.00, 40
  UNION ALL SELECT '₱7,777',   'prize-5', 7777.0000,   800,  3.00, 50
  UNION ALL SELECT '₱27,777',  'prize-6', 27777.0000,  100,  8.00, 60
  UNION ALL SELECT '₱77,777',  'prize-7', 77777.0000,  100,  8.00, 70
  UNION ALL SELECT '₱177,777', 'prize-8', 177777.0000, 100,  8.00, 80
) p
WHERE r.`kind` = 'checkin' AND r.`checkin_tier` = 'elite'
  AND NOT EXISTS (SELECT 1 FROM `bg_spin_prize` e WHERE e.`rule_id` = r.`id`);
