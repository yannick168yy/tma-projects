ALTER TABLE `bg_spin_deposit_rule`
  ADD COLUMN `name` VARCHAR(64) NOT NULL DEFAULT '' AFTER `id`,
  ADD COLUMN `max_deposit_php` DECIMAL(18,4) NULL AFTER `min_deposit_php`;

ALTER TABLE `bg_spin_chance`
  ADD COLUMN `rule_id` BIGINT UNSIGNED NULL AFTER `source_order_id`,
  ADD KEY `idx_rule_user` (`rule_id`, `user_id`);

ALTER TABLE `bg_spin_prize`
  ADD COLUMN `rule_id` BIGINT UNSIGNED NULL AFTER `id`,
  ADD KEY `idx_rule_enabled_sort` (`rule_id`, `enabled`, `sort_order`);

ALTER TABLE `bg_spin_chance`
  ADD CONSTRAINT `fk_spin_chance_rule` FOREIGN KEY (`rule_id`) REFERENCES `bg_spin_deposit_rule` (`id`);

ALTER TABLE `bg_spin_prize`
  ADD CONSTRAINT `fk_spin_prize_rule` FOREIGN KEY (`rule_id`) REFERENCES `bg_spin_deposit_rule` (`id`);

UPDATE `bg_spin_deposit_rule`
SET
  `name` = CASE
    WHEN `sort_order` = 10 THEN 'Starter Spin'
    WHEN `sort_order` = 20 THEN 'Premium Spin'
    WHEN `sort_order` = 30 THEN 'Elite Spin'
    ELSE CONCAT('Spin ', `id`)
  END,
  `max_deposit_php` = CASE
    WHEN `sort_order` = 10 THEN 579.9900
    WHEN `sort_order` = 20 THEN 1079.9900
    ELSE NULL
  END;

UPDATE `bg_spin_prize`
SET `rule_id` = (SELECT `id` FROM `bg_spin_deposit_rule` WHERE `sort_order` = 10 ORDER BY `id` ASC LIMIT 1)
WHERE `rule_id` IS NULL;

INSERT INTO `bg_spin_prize` (`rule_id`, `name`, `amount_php`, `weight`, `turnover_x`, `enabled`, `sort_order`)
SELECT r.`id`, p.`name`, p.`amount_php`, p.`weight`, p.`turnover_x`, p.`enabled`, p.`sort_order`
FROM `bg_spin_deposit_rule` r
JOIN (
  SELECT '₱17.77' AS `name`, 17.7700 AS `amount_php`, 4200 AS `weight`, 1.00 AS `turnover_x`, 1 AS `enabled`, 10 AS `sort_order`
  UNION ALL SELECT '₱77.77', 77.7700, 2600, 2.00, 1, 20
  UNION ALL SELECT '₱177.77', 177.7700, 900, 3.00, 1, 30
  UNION ALL SELECT '₱377.77', 377.7700, 250, 5.00, 1, 40
  UNION ALL SELECT '₱1,777', 1777.0000, 45, 8.00, 1, 50
  UNION ALL SELECT '₱17,777', 17777.0000, 5, 15.00, 1, 60
) p
WHERE r.`sort_order` = 20;

INSERT INTO `bg_spin_prize` (`rule_id`, `name`, `amount_php`, `weight`, `turnover_x`, `enabled`, `sort_order`)
SELECT r.`id`, p.`name`, p.`amount_php`, p.`weight`, p.`turnover_x`, p.`enabled`, p.`sort_order`
FROM `bg_spin_deposit_rule` r
JOIN (
  SELECT '₱77.77' AS `name`, 77.7700 AS `amount_php`, 4200 AS `weight`, 1.00 AS `turnover_x`, 1 AS `enabled`, 10 AS `sort_order`
  UNION ALL SELECT '₱277.77', 277.7700, 2600, 2.00, 1, 20
  UNION ALL SELECT '₱777.77', 777.7700, 900, 3.00, 1, 30
  UNION ALL SELECT '₱2,777', 2777.0000, 250, 5.00, 1, 40
  UNION ALL SELECT '₱7,777', 7777.0000, 45, 8.00, 1, 50
  UNION ALL SELECT '₱27,777', 27777.0000, 5, 15.00, 1, 60
) p
WHERE r.`sort_order` = 30;
