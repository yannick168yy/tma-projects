-- 008: 合并订单表 + 重命名
-- bg_deposit_order  → bg_order_deposit  (加 extra_data，合并 yfpay payment_order)
-- bg_withdraw_order → bg_order_withdraw (加 extra_data，合并 yfpay payment_order)

-- ────────────────────────────────────────────────────────────────
-- bg_order_deposit
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_order_deposit` (
  `order_id`      varchar(64)     NOT NULL,
  `user_id`       varchar(32)     NOT NULL,
  `amount`        decimal(18,8)   NOT NULL COMMENT 'PHP 或原始金额',
  `currency`      varchar(10)     NOT NULL DEFAULT 'PHP',
  `credited_cents` bigint         DEFAULT NULL COMMENT '实际入账 PHP 分',
  `channel_id`    varchar(32)     NOT NULL DEFAULT 'tg_wallet',
  `status`        varchar(20)     NOT NULL DEFAULT 'pending',
  `provider`      varchar(32)     DEFAULT NULL,
  `provider_ref`  varchar(128)    DEFAULT NULL COMMENT '第三方平台订单号',
  `extra_data`    json            DEFAULT NULL COMMENT '渠道专有数据',
  `paid_at`       datetime(3)     DEFAULT NULL,
  `created_at`    datetime(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    datetime(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`order_id`),
  KEY `idx_user_status` (`user_id`, `status`),
  KEY `idx_provider`    (`provider`),
  KEY `idx_created`     (`created_at`),
  CONSTRAINT `fk_order_deposit_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='存款订单（统一）';

-- 迁移旧存款记录（仅在源表存在时执行）
DROP PROCEDURE IF EXISTS `__migrate_008_deposit`;
DELIMITER //
CREATE PROCEDURE `__migrate_008_deposit`()
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_deposit_order') > 0 THEN
    INSERT IGNORE INTO `bg_order_deposit`
      (order_id, user_id, amount, currency, credited_cents, channel_id, status, provider, paid_at, created_at, updated_at)
    SELECT order_id, user_id, amount, currency, credited_cents, channel_id, status,
           COALESCE(provider, 'ammer_pay'), paid_at, created_at, updated_at
    FROM `bg_deposit_order`;
  END IF;
END //
DELIMITER ;
CALL `__migrate_008_deposit`();
DROP PROCEDURE IF EXISTS `__migrate_008_deposit`;

-- 迁移 YFPay 存款（bg_payment_order type=deposit）
INSERT IGNORE INTO `bg_order_deposit`
  (order_id, user_id, amount, currency, credited_cents, channel_id, status, provider, provider_ref, extra_data, paid_at, created_at)
SELECT
  merchant_serial,
  user_id,
  amount_cents / 100.0,
  'PHP',
  CASE WHEN state = 2 THEN amount_cents ELSE NULL END,
  CONCAT('yfpay_', LOWER(COALESCE(SUBSTRING_INDEX(channel_code, '-', 1), 'unknown'))),
  CASE WHEN state = 2 THEN 'paid' WHEN state = 3 THEN 'failed' ELSE 'pending' END,
  'yfpay',
  platform_id,
  JSON_OBJECT('channelCode', COALESCE(channel_code,''), 'payUrl', COALESCE(pay_url,''), 'state', state),
  CASE WHEN state = 2 THEN notify_at ELSE NULL END,
  created_at
FROM `bg_payment_order`
WHERE type = 'deposit';

-- ────────────────────────────────────────────────────────────────
-- bg_order_withdraw
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_order_withdraw` (
  `order_id`      varchar(64)     NOT NULL,
  `user_id`       varchar(32)     NOT NULL,
  `amount_cents`  bigint          NOT NULL,
  `currency`      char(3)         NOT NULL DEFAULT 'PHP',
  `channel_id`    varchar(32)     NOT NULL DEFAULT 'tg_wallet',
  `status`        varchar(20)     NOT NULL DEFAULT 'pending',
  `provider`      varchar(32)     DEFAULT NULL,
  `provider_ref`  varchar(128)    DEFAULT NULL,
  `extra_data`    json            DEFAULT NULL,
  `reject_reason` varchar(255)    DEFAULT NULL,
  `completed_at`  datetime(3)     DEFAULT NULL,
  `created_at`    datetime(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    datetime(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`order_id`),
  KEY `idx_user_status` (`user_id`, `status`),
  KEY `idx_provider`    (`provider`),
  KEY `idx_created`     (`created_at`),
  CONSTRAINT `fk_order_withdraw_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='提款订单（统一）';

-- 迁移旧提款记录（仅在源表存在时执行）
DROP PROCEDURE IF EXISTS `__migrate_008_withdraw`;
DELIMITER //
CREATE PROCEDURE `__migrate_008_withdraw`()
BEGIN
  IF (SELECT COUNT(*) FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_withdraw_order') > 0 THEN
    INSERT IGNORE INTO `bg_order_withdraw`
      (order_id, user_id, amount_cents, currency, channel_id, status, reject_reason, completed_at, created_at, updated_at)
    SELECT order_id, user_id, amount_cents, currency, channel_id, status, reject_reason, completed_at, created_at, updated_at
    FROM `bg_withdraw_order`;
  END IF;
END //
DELIMITER ;
CALL `__migrate_008_withdraw`();
DROP PROCEDURE IF EXISTS `__migrate_008_withdraw`;

-- 迁移 YFPay 提款（bg_payment_order type=withdrawal）
INSERT IGNORE INTO `bg_order_withdraw`
  (order_id, user_id, amount_cents, currency, channel_id, status, provider, provider_ref, extra_data, completed_at, created_at)
SELECT
  merchant_serial,
  user_id,
  amount_cents,
  'PHP',
  CONCAT('yfpay_', LOWER(COALESCE(option_code, 'unknown'))),
  CASE WHEN state = 1 THEN 'completed' WHEN state IN (2,3) THEN 'rejected' ELSE 'pending' END,
  'yfpay',
  platform_id,
  JSON_OBJECT('optionCode', COALESCE(option_code,''), 'targetAccount', COALESCE(target_account,''), 'targetOwner', COALESCE(target_owner,'')),
  CASE WHEN state = 1 THEN notify_at ELSE NULL END,
  created_at
FROM `bg_payment_order`
WHERE type = 'withdrawal';

-- 更新 bg_wallet_ledger 中的 ref_type（如有需要可跳过，ref_id 不变）
-- ref_type 值为 'deposit'/'withdraw'，与表名无关，保持不变
