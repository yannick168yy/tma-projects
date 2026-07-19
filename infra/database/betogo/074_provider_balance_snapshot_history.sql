-- 支付服务商余额刷新历史，用于排查外部余额与我方记账差异
CREATE TABLE provider_balance_snapshot_history (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  provider     VARCHAR(32)     NOT NULL,
  balance      DECIMAL(18,6)   NULL,
  frozen       DECIMAL(18,6)   NULL,
  currency     VARCHAR(16)     NOT NULL DEFAULT 'PHP',
  status       VARCHAR(16)     NOT NULL,
  error_msg    VARCHAR(512)    NULL,
  raw_response JSON            NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_provider_created_at (provider, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
