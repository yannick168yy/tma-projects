-- 自营站印尼包下线，登记行改为印度包（016 已把原印尼域名划给 IN 市场）。
-- games.betogo.id 的 APP_MARKET=ID 已被 /app/bootstrap 拒绝，这个包再也连不上线路。

UPDATE pf_tenant_app
SET package_name  = 'games.betogo.india',
    app_market    = 'IN',
    route_domains = 'betogo.app,betogo.xyz,betogo.vip,betogo.cc,betogo888.com'
WHERE tenant_id = 1 AND app_market = 'ID' AND package_name = 'games.betogo.id';
