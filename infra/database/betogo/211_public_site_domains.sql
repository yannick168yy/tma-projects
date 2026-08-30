-- betogo.games 承载 Android App API，betogo.app 作为通用下载入口，均不固定业务市场。
UPDATE bg_admin_settings
SET `value` = '[{"domain":"betogo666.com","market":"PH","enabled":true},{"domain":"betogo777.com","market":"PH","enabled":true},{"domain":"betogo.ph","market":"PH","enabled":true},{"domain":"betogo.xyz","market":"ID","enabled":true},{"domain":"betogo.vip","market":"ID","enabled":true},{"domain":"betogo888.com","market":"ID","enabled":true},{"domain":"betogo.cc","market":"ID","enabled":true},{"domain":"betogo.games","market":"PUBLIC","enabled":true},{"domain":"betogo.app","market":"PUBLIC","enabled":true}]'
WHERE `key` = 'site_domain_mappings';
