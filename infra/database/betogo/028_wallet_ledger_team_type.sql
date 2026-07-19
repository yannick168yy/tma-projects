-- 028: 预留 bg_wallet_ledger.type 扩展哨兵
-- bg_wallet_ledger 有历史行存储了非法 ENUM 值（内部为 0），
-- ALTER ENUM 在 MySQL 严格模式下失败。
-- 佣金发放到主钱包时暂用 type='bonus' + description 区分，
-- 正式扩展 ENUM 在实现发放功能时另做迁移并修复历史脏数据。

CREATE TABLE IF NOT EXISTS `bg_wallet_ledger_team_type` (
  `id`         TINYINT      NOT NULL DEFAULT 1,
  `applied_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='迁移哨兵，无业务用途';

INSERT IGNORE INTO `bg_wallet_ledger_team_type` (`id`) VALUES (1);
