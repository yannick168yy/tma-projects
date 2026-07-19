ALTER TABLE `bg_spin_prize`
  ADD COLUMN `image_key` VARCHAR(32) NOT NULL DEFAULT 'prize-1' AFTER `name`;

UPDATE `bg_spin_deposit_rule`
SET `name` = CONCAT('Deposit ', CAST(`min_deposit_php` AS UNSIGNED)),
    `max_deposit_php` = NULL,
    `chances` = 1;

INSERT INTO `bg_spin_deposit_rule` (`name`, `min_deposit_php`, `max_deposit_php`, `chances`, `enabled`, `sort_order`)
SELECT x.`name`, x.`amount`, NULL, 1, 1, x.`sort_order`
FROM (
  SELECT 'Deposit 2000' AS `name`, 2000.0000 AS `amount`, 40 AS `sort_order`
  UNION ALL SELECT 'Deposit 5000', 5000.0000, 50
  UNION ALL SELECT 'Deposit 10000', 10000.0000, 60
) x
WHERE NOT EXISTS (
  SELECT 1 FROM `bg_spin_deposit_rule` r WHERE r.`sort_order` = x.`sort_order`
);

UPDATE `bg_spin_prize`
SET `image_key` = CONCAT('prize-', (((`sort_order` DIV 10) - 1) MOD 8) + 1)
WHERE `image_key` = 'prize-1';
