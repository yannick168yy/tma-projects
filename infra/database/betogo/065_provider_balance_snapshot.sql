-- 支付服务商余额快照（定时 1h 刷新 + 手动刷新，用于与我方记账核对）
-- 每个 provider 一行，刷新时 upsert 覆盖
CREATE TABLE IF NOT EXISTS provider_balance_snapshot (
  provider    VARCHAR(32)   NOT NULL PRIMARY KEY,
  balance     DECIMAL(18,6) NOT NULL DEFAULT 0,
  frozen      DECIMAL(18,6) NOT NULL DEFAULT 0,
  currency    VARCHAR(16)   NOT NULL DEFAULT 'PHP',
  status      VARCHAR(16)   NOT NULL DEFAULT 'ok',   -- ok | error
  error_msg   VARCHAR(512)  NULL,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
