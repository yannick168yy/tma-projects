-- 235: 首页选品为 INR 单独分池。此前印度用户落在 PHP 池、吃的是 PHP 的首页布局，
-- 这里把 PHP 已配置的布局复制一份给 INR，切池后印度首页与切换前保持一致。
INSERT IGNORE INTO bg_homepage_section_visibility (section_key, currency, hidden, sort_order, params)
SELECT section_key, 'INR', hidden, sort_order, params
FROM bg_homepage_section_visibility
WHERE currency = 'PHP';
