ALTER TABLE `bg_home_content`
  MODIFY COLUMN `action_type` ENUM('promo','cashback','spin','lobby','none','path','url') NOT NULL DEFAULT 'none',
  MODIFY COLUMN `action_value` VARCHAR(255) NULL;
