-- 016: 金额统一存元（DECIMAL），修复乱码注释，补全缺失注释
-- 所有 _cents BIGINT 列改为元单位 DECIMAL(18,4)，并重命名去掉 _cents 后缀

SET NAMES utf8mb4;

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. 修复乱码 TABLE 注释（009 迁移未设 SET NAMES utf8mb4 导致）
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE `admin_accounts`    COMMENT='后台管理员账号';
ALTER TABLE `admin_audit_log`   COMMENT='管理员操作审计日志';
ALTER TABLE `bg_admin_settings` COMMENT='系统全局配置项';
ALTER TABLE `bg_login_log`      COMMENT='用户登录历史';
ALTER TABLE `bg_order_deposit`  COMMENT='存款订单（统一）';
ALTER TABLE `bg_order_withdraw` COMMENT='提款订单（统一）';
ALTER TABLE `bg_exchange_rate`  COMMENT='第三方汇率快照，每小时刷新一次';
ALTER TABLE `sg_settlement_report` COMMENT='Slotegrator 日结算报告及本地核对结果';

-- 补全缺失 TABLE 注释
ALTER TABLE `bg_payment_order` COMMENT='YFPay 支付订单（历史数据，已迁移至 bg_order_deposit/withdraw）';
ALTER TABLE `cs_conversation`  COMMENT='客服会话';
ALTER TABLE `cs_message`       COMMENT='客服消息';
ALTER TABLE `cs_faq`           COMMENT='客服 FAQ 知识库';

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. 修复乱码 COLUMN 注释（008/014 迁移未设 SET NAMES utf8mb4）
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE `bg_order_deposit`
  MODIFY COLUMN `amount`      DECIMAL(18,8) NOT NULL COMMENT 'PHP 或原始金额',
  MODIFY COLUMN `extra_data`  JSON          DEFAULT NULL COMMENT '渠道专有数据';

ALTER TABLE `bg_exchange_rate`
  MODIFY COLUMN `currency_from` CHAR(5)       NOT NULL COMMENT '来源币种，如 EUR/USDT',
  MODIFY COLUMN `currency_to`   CHAR(5)       NOT NULL COMMENT '目标币种，如 PHP',
  MODIFY COLUMN `rate`          DECIMAL(18,8) NOT NULL COMMENT '1 currency_from = rate currency_to';

ALTER TABLE `sg_settlement_report`
  MODIFY COLUMN `sg_bet_amount`    DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT 'SG 报告总投注（原币）',
  MODIFY COLUMN `sg_win_amount`    DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT 'SG 报告总派彩（原币）',
  MODIFY COLUMN `sg_ggr`           DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT 'SG GGR = bet - win（原币）',
  MODIFY COLUMN `discrepancy_note` TEXT          NULL COMMENT '差异说明，NULL 表示核对一致',
  MODIFY COLUMN `raw_data`         JSON          NULL COMMENT 'SG 原始响应快照';

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. bg_payment_order 字段补注释
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE `bg_payment_order`
  MODIFY COLUMN `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT   COMMENT '自增主键',
  MODIFY COLUMN `user_id`        VARCHAR(64)     NOT NULL                  COMMENT '关联 bg_user.id',
  MODIFY COLUMN `provider`       VARCHAR(20)     NOT NULL                  COMMENT '支付服务商，如 yfpay',
  MODIFY COLUMN `type`           ENUM('deposit','withdrawal') NOT NULL      COMMENT '交易类型',
  MODIFY COLUMN `merchant_serial` VARCHAR(64)    NOT NULL                  COMMENT '商户流水号（即 order_id）',
  MODIFY COLUMN `platform_id`    VARCHAR(64)     NULL                      COMMENT '第三方平台订单号',
  MODIFY COLUMN `channel_code`   VARCHAR(64)     NULL                      COMMENT '支付渠道代码',
  MODIFY COLUMN `option_code`    VARCHAR(32)     NULL                      COMMENT '出款渠道选项代码',
  MODIFY COLUMN `target_account` VARCHAR(128)    NULL                      COMMENT '收款账号',
  MODIFY COLUMN `target_owner`   VARCHAR(128)    NULL                      COMMENT '收款账号持有人',
  MODIFY COLUMN `state`          TINYINT         NOT NULL DEFAULT 0         COMMENT '状态: 0=pending 1=success 2=failed 3=rejected',
  MODIFY COLUMN `pay_url`        TEXT            NULL                      COMMENT '支付跳转 URL',
  MODIFY COLUMN `extra_params`   VARCHAR(512)    NULL                      COMMENT '扩展参数 JSON',
  MODIFY COLUMN `notify_at`      DATETIME        NULL                      COMMENT '回调通知时间',
  MODIFY COLUMN `created_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  MODIFY COLUMN `updated_at`     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. 金额列统一：_cents BIGINT → 元 DECIMAL(18,4)（幂等：检查旧列是否存在）
-- ══════════════════════════════════════════════════════════════════════════════

DROP PROCEDURE IF EXISTS `__migrate_016`;
DELIMITER $$
CREATE PROCEDURE `__migrate_016`()
BEGIN

  -- ── bg_wallet ────────────────────────────────────────────────────────────────
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_wallet' AND COLUMN_NAME='available_cents') > 0 THEN
    ALTER TABLE `bg_wallet`
      ADD COLUMN `available` DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '可用余额（PHP 元）' AFTER `available_cents`,
      ADD COLUMN `frozen`    DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '冻结金额（PHP 元）' AFTER `frozen_cents`;
    UPDATE `bg_wallet` SET available = available_cents / 100, frozen = frozen_cents / 100;
    ALTER TABLE `bg_wallet` DROP COLUMN `available_cents`, DROP COLUMN `frozen_cents`;
  END IF;

  -- ── bg_wallet_ledger ──────────────────────────────────────────────────────────
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_wallet_ledger' AND COLUMN_NAME='amount_cents') > 0 THEN
    ALTER TABLE `bg_wallet_ledger`
      ADD COLUMN `amount`      DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '账变金额（PHP 元，正负）' AFTER `amount_cents`,
      ADD COLUMN `balance_yuan` DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '账变后余额（PHP 元）'   AFTER `balance_after`;
    UPDATE `bg_wallet_ledger` SET amount = amount_cents / 100, balance_yuan = balance_after / 100;
    ALTER TABLE `bg_wallet_ledger` DROP COLUMN `amount_cents`, DROP COLUMN `balance_after`;
    ALTER TABLE `bg_wallet_ledger` RENAME COLUMN `balance_yuan` TO `balance_after`;
  END IF;

  -- ── bg_bet_order ──────────────────────────────────────────────────────────────
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_bet_order' AND COLUMN_NAME='amount_cents') > 0 THEN
    ALTER TABLE `bg_bet_order`
      ADD COLUMN `amount` DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '换算后 PHP 金额（元）' AFTER `amount_cents`;
    UPDATE `bg_bet_order` SET amount = amount_cents / 100;
    ALTER TABLE `bg_bet_order` DROP COLUMN `amount_cents`;
  END IF;

  -- ── bg_order_deposit ──────────────────────────────────────────────────────────
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_order_deposit' AND COLUMN_NAME='credited_cents') > 0 THEN
    ALTER TABLE `bg_order_deposit`
      ADD COLUMN `credited` DECIMAL(18,4) NULL COMMENT '实际入账 PHP 元' AFTER `credited_cents`;
    UPDATE `bg_order_deposit` SET credited = credited_cents / 100 WHERE credited_cents IS NOT NULL;
    ALTER TABLE `bg_order_deposit` DROP COLUMN `credited_cents`;
  END IF;

  -- ── bg_order_withdraw ─────────────────────────────────────────────────────────
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_order_withdraw' AND COLUMN_NAME='amount_cents') > 0 THEN
    ALTER TABLE `bg_order_withdraw`
      ADD COLUMN `amount` DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '提款金额（PHP 元）' AFTER `amount_cents`;
    UPDATE `bg_order_withdraw` SET amount = amount_cents / 100;
    ALTER TABLE `bg_order_withdraw` DROP COLUMN `amount_cents`;
  END IF;

  -- ── bg_payment_order ──────────────────────────────────────────────────────────
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_payment_order' AND COLUMN_NAME='amount_cents') > 0 THEN
    ALTER TABLE `bg_payment_order`
      ADD COLUMN `amount` DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '金额（PHP 元）' AFTER `amount_cents`;
    UPDATE `bg_payment_order` SET amount = amount_cents / 100;
    ALTER TABLE `bg_payment_order` DROP COLUMN `amount_cents`;
  END IF;

  -- ── bg_promo_claim ────────────────────────────────────────────────────────────
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_promo_claim' AND COLUMN_NAME='amount_cents') > 0 THEN
    ALTER TABLE `bg_promo_claim`
      ADD COLUMN `amount` DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '奖励金额（PHP 元）' AFTER `amount_cents`;
    UPDATE `bg_promo_claim` SET amount = amount_cents / 100;
    ALTER TABLE `bg_promo_claim` DROP COLUMN `amount_cents`;
  END IF;

  -- ── bg_referral_record ────────────────────────────────────────────────────────
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_referral_record' AND COLUMN_NAME='reward_cents') > 0 THEN
    ALTER TABLE `bg_referral_record`
      ADD COLUMN `reward` DECIMAL(18,4) NULL COMMENT '奖励金额（PHP 元）' AFTER `reward_cents`;
    UPDATE `bg_referral_record` SET reward = reward_cents / 100 WHERE reward_cents IS NOT NULL;
    ALTER TABLE `bg_referral_record` DROP COLUMN `reward_cents`;
  END IF;

  -- ── sg_settlement_report ──────────────────────────────────────────────────────
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sg_settlement_report' AND COLUMN_NAME='local_bet_cents') > 0 THEN
    ALTER TABLE `sg_settlement_report`
      ADD COLUMN `local_bet` DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '本地 bg_bet_order 投注总额（PHP 元）' AFTER `local_bet_cents`,
      ADD COLUMN `local_win` DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '本地 bg_bet_order 派彩总额（PHP 元）' AFTER `local_win_cents`;
    UPDATE `sg_settlement_report` SET local_bet = local_bet_cents / 100, local_win = local_win_cents / 100;
    ALTER TABLE `sg_settlement_report` DROP COLUMN `local_bet_cents`, DROP COLUMN `local_win_cents`;
  END IF;

END $$
DELIMITER ;
CALL `__migrate_016`();
DROP PROCEDURE IF EXISTS `__migrate_016`;
