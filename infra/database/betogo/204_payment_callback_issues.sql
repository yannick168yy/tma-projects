-- 204: 支付回调异常留痕，供告警与对账报表使用。
SET NAMES utf8mb4;

CREATE TABLE bg_payment_callback_issue (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider VARCHAR(32) NOT NULL,
  issue_type VARCHAR(48) NOT NULL,
  order_id VARCHAR(64) NULL,
  provider_order_id VARCHAR(128) NULL,
  status_value VARCHAR(32) NULL,
  detail JSON NULL,
  notified TINYINT(1) NOT NULL DEFAULT 0,
  resolved TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  KEY idx_provider_created (provider, created_at),
  KEY idx_unresolved (resolved, notified, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='支付回调异常与对账问题';
