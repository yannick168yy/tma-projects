-- 007: bg_wallet_ledger.type 枚举添加 admin_adjust（幂等）
SET @col_type = (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_wallet_ledger' AND COLUMN_NAME = 'type'
);
SET @need = IF(@col_type NOT LIKE '%admin_adjust%',
  "ALTER TABLE `bg_wallet_ledger` MODIFY COLUMN `type` ENUM('deposit','withdraw','bet','win','red_packet','bonus','adjust','admin_adjust') NOT NULL",
  'SELECT 1'
);
PREPARE st FROM @need; EXECUTE st; DEALLOCATE PREPARE st;
