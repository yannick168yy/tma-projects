-- YF Pay 代收/代付订单表
CREATE TABLE IF NOT EXISTS bg_payment_order (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         VARCHAR(64)  NOT NULL,
  provider        VARCHAR(20)  NOT NULL DEFAULT 'yfpay',
  type            ENUM('deposit','withdrawal') NOT NULL,
  merchant_serial VARCHAR(64)  NOT NULL,
  platform_id     VARCHAR(64)  DEFAULT NULL,
  amount_cents    BIGINT       NOT NULL,
  channel_code    VARCHAR(64)  DEFAULT NULL,
  option_code     VARCHAR(32)  DEFAULT NULL,   -- 提现银行编码
  target_account  VARCHAR(128) DEFAULT NULL,   -- 提现收款账号
  target_owner    VARCHAR(128) DEFAULT NULL,   -- 提现收款人
  state           TINYINT      NOT NULL DEFAULT 0,
  pay_url         TEXT         DEFAULT NULL,
  extra_params    VARCHAR(512) DEFAULT NULL,
  notify_at       DATETIME     DEFAULT NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_merchant_serial (merchant_serial),
  INDEX idx_user_id (user_id),
  INDEX idx_state   (state),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
