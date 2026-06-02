-- 028: bg_wallet_ledger.type ENUM 增加 team_commission
-- 用存储过程替代 PREPARE/EXECUTE，避免双引号内单引号的解析问题

DROP PROCEDURE IF EXISTS `__alter_028_ledger_type`;
DELIMITER //
CREATE PROCEDURE `__alter_028_ledger_type`()
BEGIN
  DECLARE has_tc INT DEFAULT 0;
  SELECT COUNT(*) INTO has_tc
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'bg_wallet_ledger'
    AND COLUMN_NAME  = 'type'
    AND COLUMN_TYPE LIKE '%team_commission%';

  IF has_tc = 0 THEN
    ALTER TABLE `bg_wallet_ledger`
      MODIFY COLUMN `type`
        ENUM('deposit','withdraw','bet','win','red_packet','bonus','adjust','team_commission')
        NOT NULL;
  END IF;
END //
DELIMITER ;
CALL `__alter_028_ledger_type`();
DROP PROCEDURE IF EXISTS `__alter_028_ledger_type`;

-- 哨兵表
CREATE TABLE IF NOT EXISTS `bg_wallet_ledger_team_type` (
  `id` TINYINT NOT NULL DEFAULT 1,
  `applied_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='迁移哨兵，无业务用途';

INSERT IGNORE INTO `bg_wallet_ledger_team_type` (`id`) VALUES (1);
