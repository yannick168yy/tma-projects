-- 229: 将原印尼站域名整体切换为印度站，已有用户市场与钱包不做批量迁移。

UPDATE bg_admin_settings
SET `value` = REPLACE(
  REPLACE(`value`, '"market":"ID"', '"market":"IN"'),
  '"appMarket":"ID"', '"appMarket":"IN"'
)
WHERE `key` = 'site_domain_mappings';
