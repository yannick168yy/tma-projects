-- 163: 首充嘉年华 PHP 档位调整（YFPay 单笔最低 100）
-- 去掉 20 / 50 两档（低于 YFPay 最低充值 100），新增 2000 / 20000 两档。
-- 精确 WHERE 删除指定配置行；INSERT 用 ON DUPLICATE KEY UPDATE 保证幂等。
DELETE FROM `bg_firstdep_tiers`
WHERE `currency` = 'PHP' AND `deposit_amount` IN (20, 50);

INSERT INTO `bg_firstdep_tiers` (`currency`, `deposit_amount`, `bonus_amount`) VALUES
  ('PHP', 2000,  100),
  ('PHP', 20000, 500)
ON DUPLICATE KEY UPDATE `bonus_amount` = VALUES(`bonus_amount`);
