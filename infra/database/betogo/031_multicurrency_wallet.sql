-- 多币种钱包重构：重建 bg_wallet（复合主键）、统一充提订单表、账本加 currency 列
-- 旧表 bg_order_deposit / bg_order_withdraw / bg_matrix_deposit_order / bg_matrix_withdraw_order
-- 在代码切换完成后由 032 迁移文件统一 DROP

-- ── 1. 重建 bg_wallet（user_id + currency 复合主键）────────────────────────────
-- 仅当 PK 还是单列（旧 schema）时才 DROP + 重建；已迁移则跳过，保留数据
SET @pk_cols = COALESCE((
  SELECT COUNT(DISTINCT COLUMN_NAME) FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bg_wallet' AND CONSTRAINT_NAME='PRIMARY'
), 0);
SET @s = IF(@pk_cols < 2, 'DROP TABLE IF EXISTS bg_wallet', 'SELECT 1');
PREPARE _s FROM @s; EXECUTE _s; DEALLOCATE PREPARE _s;

CREATE TABLE IF NOT EXISTS bg_wallet (
  user_id   VARCHAR(64)    NOT NULL,
  currency  VARCHAR(16)    NOT NULL,
  available DECIMAL(18,6)  NOT NULL DEFAULT 0,
  frozen    DECIMAL(18,6)  NOT NULL DEFAULT 0,
  version   INT            NOT NULL DEFAULT 0,
  updated_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, currency),
  INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 2. bg_wallet_ledger 加 currency 列 ─────────────────────────────────────────
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bg_wallet_ledger' AND COLUMN_NAME = 'currency'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE bg_wallet_ledger ADD COLUMN currency VARCHAR(16) NOT NULL DEFAULT ''PHP'' AFTER user_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 3. 统一充值订单表 ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bg_deposit_order (
  order_id     VARCHAR(64)   NOT NULL,
  user_id      VARCHAR(64)   NOT NULL,
  channel      VARCHAR(32)   NOT NULL,
  currency     VARCHAR(16)   NOT NULL,
  amount       DECIMAL(18,6) NOT NULL,
  status       ENUM('pending','paid','failed','rejected') NOT NULL DEFAULT 'pending',
  credited     TINYINT(1)    NOT NULL DEFAULT 0,
  tx_hash      VARCHAR(128)  NULL,
  from_address VARCHAR(256)  NULL,
  to_address   VARCHAR(256)  NULL,
  chain        VARCHAR(32)   NULL,
  extra        JSON          NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (order_id),
  INDEX idx_user_created (user_id, created_at),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── 4. 统一提现订单表 ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bg_withdraw_order (
  order_id      VARCHAR(64)   NOT NULL,
  user_id       VARCHAR(64)   NOT NULL,
  channel       VARCHAR(32)   NOT NULL,
  currency      VARCHAR(16)   NOT NULL,
  amount        DECIMAL(18,6) NOT NULL,
  status        ENUM('pending','processing','completed','failed','rejected') NOT NULL DEFAULT 'pending',
  to_address    VARCHAR(256)  NULL,
  chain         VARCHAR(32)   NULL,
  refunded      TINYINT(1)    NOT NULL DEFAULT 0,
  reject_reason VARCHAR(512)  NULL,
  extra         JSON          NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (order_id),
  INDEX idx_user_created (user_id, created_at),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
