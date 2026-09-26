-- 自营站停用印尼市场入口，复用原印尼域名作为印度 INR 市场。

INSERT INTO pf_tenant_market (tenant_id, market, currency, timezone, enabled)
VALUES (1, 'IN', 'INR', 'Asia/Kolkata', 1)
ON DUPLICATE KEY UPDATE
  currency = VALUES(currency),
  timezone = VALUES(timezone),
  enabled = VALUES(enabled);

UPDATE pf_tenant_market
SET enabled = 0
WHERE tenant_id = 1 AND market = 'ID';

UPDATE pf_tenant_domain
SET market = 'IN',
    app_market = IF(app_market = 'ID', 'IN', app_market)
WHERE tenant_id = 1 AND market = 'ID';
