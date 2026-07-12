-- bg_promo_config.config_value 原 VARCHAR(255) 存不下 bonuscards/popups 的 JSON（5 张卡片约 291 字符）
-- 改 TEXT 以容纳活动配置 JSON，避免保存报 Data too long
ALTER TABLE `bg_promo_config` MODIFY COLUMN `config_value` TEXT NOT NULL;
