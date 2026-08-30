-- 团队佣金按注册市场切业务日：菲律宾 UTC+8、印尼 UTC+7。
ALTER TABLE bg_user
  ADD COLUMN market VARCHAR(2) NOT NULL DEFAULT 'PH' AFTER locale,
  ADD INDEX idx_user_market (market);

-- 生产启用印尼站前的既有用户全部属于菲律宾市场；market 默认值 PH 即为最终归属。
-- 印尼站开放后的新用户由注册服务根据后台域名映射写入 ID，不在迁移中回溯猜测历史市场。

ALTER TABLE bg_team_turnover_daily
  ADD COLUMN market VARCHAR(2) NOT NULL DEFAULT 'PH' AFTER currency_code,
  DROP INDEX uk_user_date_currency,
  ADD UNIQUE KEY uk_user_date_currency_market (user_id, date, currency_code, market),
  ADD INDEX idx_market_date_settled (market, date, settled);

UPDATE bg_team_turnover_daily t
JOIN bg_user u ON u.id = t.user_id
SET t.market = u.market;

ALTER TABLE bg_team_commission
  ADD COLUMN market VARCHAR(2) NOT NULL DEFAULT 'PH' AFTER currency,
  DROP INDEX uk_commission_full,
  ADD UNIQUE KEY uk_commission_market
    (beneficiary_id, from_user_id, period, currency, market, level),
  ADD INDEX idx_commission_market_period (market, period, status);

UPDATE bg_team_commission c
JOIN bg_user u ON u.id = c.from_user_id
SET c.market = u.market;

CREATE TABLE bg_team_settlement_state (
  market VARCHAR(2) NOT NULL,
  last_auto_settlement VARCHAR(10) NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (market)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='团队佣金各市场自动结算进度';

INSERT INTO bg_team_settlement_state (market, last_auto_settlement) VALUES
  ('PH', (SELECT last_auto_settlement FROM bg_team_config WHERE id = 1)),
  ('ID', NULL);
