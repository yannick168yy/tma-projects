INSERT INTO `bg_spin_prize` (`rule_id`, `name`, `image_key`, `amount_php`, `weight`, `turnover_x`, `enabled`, `sort_order`)
SELECT r.`id`, p.`name`, p.`image_key`, p.`amount_php`, p.`weight`, p.`turnover_x`, 1, p.`sort_order`
FROM `bg_spin_deposit_rule` r
JOIN (
  SELECT '₱7.77' AS `name`, 'prize-1' AS `image_key`, 7.7700 AS `amount_php`, 3000 AS `weight`, 1.00 AS `turnover_x`, 10 AS `sort_order`
  UNION ALL SELECT '₱17.77', 'prize-2', 17.7700, 3000, 1.00, 20
  UNION ALL SELECT '₱77.77', 'prize-3', 77.7700, 800, 3.00, 30
  UNION ALL SELECT '₱277.77', 'prize-4', 277.7700, 800, 3.00, 40
  UNION ALL SELECT '₱777.77', 'prize-5', 777.7700, 800, 3.00, 50
  UNION ALL SELECT '₱1,777', 'prize-6', 1777.0000, 100, 8.00, 60
  UNION ALL SELECT '₱7,777', 'prize-7', 7777.0000, 100, 8.00, 70
  UNION ALL SELECT '₱17,777', 'prize-8', 17777.0000, 100, 8.00, 80
) p
WHERE r.`min_deposit_php` IN (2000.0000, 5000.0000, 10000.0000)
  AND NOT EXISTS (
    SELECT 1
    FROM `bg_spin_prize` existing
    WHERE existing.`rule_id` = r.`id`
      AND existing.`sort_order` = p.`sort_order`
  );
