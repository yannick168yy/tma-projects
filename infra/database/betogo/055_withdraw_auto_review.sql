-- 自动取款审核模块
-- 提案进入后台后由规则引擎自动审核：全部规则通过则自动批准（=自动出款），
-- 任一规则命中则转人工。规则只会"转人工"，不会拒单。

-- 提单上记录审核结论，供后台列表筛选/展示
ALTER TABLE bg_withdraw_order
  ADD COLUMN review_verdict VARCHAR(16) NULL COMMENT '自动审核结论: pass(自动通过) | manual(转人工) | NULL(未审)' AFTER status,
  ADD COLUMN reviewed_at DATETIME(3) NULL COMMENT '自动审核时间' AFTER review_verdict;

-- 规则配置：阈值可后台调，改完即时生效
CREATE TABLE IF NOT EXISTS bg_withdraw_review_config (
  rule_code   VARCHAR(40)   NOT NULL COMMENT '规则代码',
  enabled     TINYINT(1)    NOT NULL DEFAULT 1 COMMENT '是否启用',
  threshold   DECIMAL(18,4) NULL COMMENT '主阈值（单一参数规则用）',
  params      JSON          NULL COMMENT '多参数规则的配置（如分币种阈值）',
  updated_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (rule_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='取款自动审核规则配置';

-- 逐规则审核结果：后台展开查看"为何转人工/为何放行"，及命中统计
CREATE TABLE IF NOT EXISTS bg_withdraw_review_log (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id     VARCHAR(64)   NOT NULL COMMENT '提款订单号',
  user_id      VARCHAR(32)   NOT NULL,
  rule_code    VARCHAR(40)   NOT NULL,
  verdict      ENUM('pass','manual') NOT NULL,
  actual_value DECIMAL(18,4) NULL COMMENT '规则计算出的实际值',
  threshold    DECIMAL(18,4) NULL COMMENT '命中时对照的阈值',
  detail       JSON          NULL COMMENT '附加上下文',
  created_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_order (order_id),
  KEY idx_rule_time (rule_code, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='取款自动审核逐规则结果';

-- 规则默认配置（阈值偏宽松，保证大多数提案自动通过，仅异常转人工）
INSERT IGNORE INTO bg_withdraw_review_config (rule_code, enabled, threshold, params) VALUES
  ('turnover',                 1, NULL,        NULL),
  ('large_amount',             1, NULL,        JSON_OBJECT('phpCents', 5000000, 'usdt', 20000)),
  ('large_profit',             1, 20000000,    NULL),
  ('high_multiple_profit',     1, 10,          NULL),
  ('high_multiple_profit_24h', 1, 15,          NULL),
  ('deposit_source',           1, NULL,        NULL),
  ('total_bonus',              1, 5000000,     NULL),
  ('first_withdraw_no_deposit',1, NULL,        NULL),
  ('upline_blacklist',         1, NULL,        NULL);
