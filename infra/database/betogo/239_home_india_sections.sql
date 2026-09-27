-- 首页新增印度站专区 crash（Crash & 即开）/ indianCards（印度纸牌）。
-- 区块表「无行 = 显示」，不写行的话菲律宾/印尼/USDT 首页也会冒出这两块，所以在这三个币种下默认隐藏；
-- INR 不写行（显示），顺序由后台「首页布局」或 scripts/inr-home-config.mjs 配置。
-- INSERT IGNORE：运营若已在后台为这些币种配过这两块，保留其配置。
INSERT IGNORE INTO bg_homepage_section_visibility (section_key, currency, hidden)
VALUES ('crash', 'PHP', 1), ('crash', 'IDR', 1), ('crash', 'USDT', 1),
       ('indianCards', 'PHP', 1), ('indianCards', 'IDR', 1), ('indianCards', 'USDT', 1);
