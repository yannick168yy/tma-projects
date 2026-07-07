-- 120: 佣金提现(team)的 same_ip_device 规则补齐设备阈值参数
-- 084 建 team 默认配置时 same_ip_device 只写了 ip 阈值(JSON_OBJECT('ip',3))，漏了 device，
-- 导致后台该规则看不到设备阈值配置项、设备维度形同虚设。此处按玩家版口径补 device=2
-- (一台设备出现 2 个账号即可疑)。JSON_SET 仅补键、保留现有 ip，只命中这一行。

UPDATE bg_withdraw_review_config
   SET params = JSON_SET(COALESCE(params, JSON_OBJECT()), '$.device', 2)
 WHERE scope = 'team' AND rule_code = 'same_ip_device'
   AND JSON_EXTRACT(params, '$.device') IS NULL;
