-- Matrix 充值地址缓存表
CREATE TABLE IF NOT EXISTS bg_matrix_deposit_address (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      VARCHAR(64)  NOT NULL COMMENT '商户用户 ID',
  symbol       VARCHAR(20)  NOT NULL COMMENT '币种，如 USDT',
  chain        VARCHAR(20)  NOT NULL COMMENT '链，如 TRON',
  address      VARCHAR(128) NOT NULL COMMENT 'Matrix 分配的链上地址',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_symbol_chain (user_id, symbol, chain),
  KEY idx_address (address)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Matrix 充值地址缓存';

-- Matrix 充值订单表（由通知回调写入）
CREATE TABLE IF NOT EXISTS bg_matrix_deposit_order (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_no     VARCHAR(64)  NOT NULL COMMENT 'Matrix 平台充值订单号',
  user_id      VARCHAR(64)  NOT NULL COMMENT '商户用户 ID',
  symbol       VARCHAR(20)  NOT NULL COMMENT '币种',
  chain        VARCHAR(20)  NOT NULL COMMENT '链',
  amount       DECIMAL(24,8) NOT NULL COMMENT '充值金额',
  from_address VARCHAR(128) NULL     COMMENT '付款地址',
  to_address   VARCHAR(128) NOT NULL COMMENT '收款地址',
  tx_hash      VARCHAR(128) NULL     COMMENT '交易哈希',
  status       TINYINT      NOT NULL DEFAULT 0 COMMENT '0待处理 1已上链 2已收款 3成功 4失败',
  credited     TINYINT      NOT NULL DEFAULT 0 COMMENT '是否已入账 0否 1是',
  credited_php DECIMAL(16,4) NULL    COMMENT '折算入账 PHP 金额',
  on_chain_time BIGINT NULL          COMMENT '上链时间毫秒时间戳 UTC',
  finish_time  BIGINT NULL           COMMENT '完成时间毫秒时间戳 UTC',
  notify_raw   TEXT NULL             COMMENT '最近一次原始通知 JSON（调试用）',
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_order_no (order_no),
  KEY idx_user_id (user_id),
  KEY idx_status (status),
  KEY idx_tx_hash (tx_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Matrix 充值订单';

-- Matrix 提现订单表
CREATE TABLE IF NOT EXISTS bg_matrix_withdraw_order (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  order_no            VARCHAR(64)   NULL     COMMENT 'Matrix 平台提现订单号（创建成功后回填）',
  merchant_order_no   VARCHAR(64)   NOT NULL COMMENT '商户订单号（本地生成）',
  user_id             VARCHAR(64)   NOT NULL COMMENT '商户用户 ID',
  symbol              VARCHAR(20)   NOT NULL COMMENT '币种',
  chain               VARCHAR(20)   NOT NULL COMMENT '链',
  amount              DECIMAL(24,8) NOT NULL COMMENT '提现数量（链上单位）',
  amount_php          DECIMAL(16,4) NOT NULL COMMENT '扣除余额 PHP 金额',
  to_address          VARCHAR(128)  NOT NULL COMMENT '目标收款地址',
  from_address        VARCHAR(128)  NULL     COMMENT '平台出款地址',
  tx_hash             VARCHAR(128)  NULL     COMMENT '交易哈希',
  status              TINYINT       NOT NULL DEFAULT 0
    COMMENT '0待处理 1待渠道提交 2补充gas 3已提交 4已上链 5成功 6失败',
  local_status        VARCHAR(20)   NOT NULL DEFAULT 'pending'
    COMMENT 'pending/completed/failed（映射到 OrderWithdraw.status）',
  refunded            TINYINT       NOT NULL DEFAULT 0 COMMENT '失败后余额是否已退回 0否 1是',
  on_chain_time       BIGINT        NULL     COMMENT '上链时间毫秒时间戳 UTC',
  finish_time         BIGINT        NULL     COMMENT '完成时间毫秒时间戳 UTC',
  notify_raw          TEXT          NULL     COMMENT '最近一次原始通知 JSON（调试用）',
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_merchant_order_no (merchant_order_no),
  KEY idx_order_no (order_no),
  KEY idx_user_id (user_id),
  KEY idx_status (status),
  KEY idx_local_status (local_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Matrix 提现订单';
