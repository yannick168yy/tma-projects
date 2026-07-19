-- 取款审核模块化：审核快照、逐规则状态扩展、人工处理留痕、风控名单、4 条新规则

-- 逐规则状态扩展：除 pass/manual 外，记录 skipped(规则被禁用)、error(规则执行异常)
ALTER TABLE bg_withdraw_review_log
  MODIFY COLUMN verdict ENUM('pass','manual','skipped','error') NOT NULL,
  ADD COLUMN round TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '审核轮次（重跑递增）' AFTER rule_code;

-- 提案上的审核快照 + 人工处理留痕
ALTER TABLE bg_withdraw_order
  ADD COLUMN review_round   TINYINT UNSIGNED NULL COMMENT '当前审核轮次' AFTER reviewed_at,
  ADD COLUMN review_ms      INT          NULL COMMENT '审核耗时(ms)' AFTER review_round,
  ADD COLUMN review_snapshot JSON        NULL COMMENT '审核当时的上下文快照（防窗口漂移）' AFTER review_ms,
  ADD COLUMN handled_by     VARCHAR(64)  NULL COMMENT '人工处理人(管理员用户名)' AFTER review_snapshot,
  ADD COLUMN handled_at     DATETIME(3)  NULL COMMENT '人工处理时间' AFTER handled_by;

-- 风控名单：IP / 设备 / 地域 / 用户
CREATE TABLE IF NOT EXISTS bg_risk_blacklist (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  type        ENUM('ip','device','region','user') NOT NULL,
  value       VARCHAR(128)  NOT NULL COMMENT 'IP/设备ID/地域/用户ID',
  reason      VARCHAR(255)  NULL,
  created_by  VARCHAR(64)   NULL COMMENT '添加人',
  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_type_value (type, value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='风控黑名单';

-- 4 条新规则默认配置（阈值偏宽松）
INSERT IGNORE INTO bg_withdraw_review_config (rule_code, enabled, threshold, params) VALUES
  ('same_ip_device',     1, NULL, JSON_OBJECT('ip', 3, 'device', 3)),
  ('promo_turnover',     1, NULL, NULL),
  ('tampered_bet',       1, NULL, NULL),
  ('commission_anomaly', 1, NULL, NULL);
