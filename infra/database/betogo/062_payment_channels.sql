-- 支付渠道表
CREATE TABLE IF NOT EXISTS payment_channels (
  id          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  name        VARCHAR(50)     NOT NULL COMMENT 'gcash / maya / etc',
  provider    VARCHAR(50)     NOT NULL COMMENT 'beepay / yfpay / etc',
  label       VARCHAR(100)    NOT NULL COMMENT '后台显示名称',
  enabled     TINYINT(1)      NOT NULL DEFAULT 1,
  sort_order  INT             NOT NULL DEFAULT 0,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_name_provider (name, provider)
);

-- 支付策略规则表（按金额区间分配权重）
CREATE TABLE IF NOT EXISTS payment_channel_rules (
  id          INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  channel_id  INT UNSIGNED    NOT NULL,
  currency    VARCHAR(10)     NOT NULL DEFAULT 'PHP',
  amount_min  DECIMAL(18,2)   NULL     COMMENT 'NULL 表示无下限',
  amount_max  DECIMAL(18,2)   NULL     COMMENT 'NULL 表示无上限',
  weight      INT UNSIGNED    NOT NULL DEFAULT 100,
  enabled     TINYINT(1)      NOT NULL DEFAULT 1,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_pcr_channel FOREIGN KEY (channel_id) REFERENCES payment_channels(id) ON DELETE CASCADE
);
