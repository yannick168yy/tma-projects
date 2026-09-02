-- 支付渠道客户端展示开关：关闭后不在钱包中渲染，不影响服务端路由开关
--
-- 幂等写法：该列曾被手工加到测试库但没记进 schema_migrations，直接 ADD COLUMN 会撞
-- Duplicate column 并中止整个部署。用 information_schema 判断后再执行。
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'payment_channels'
     AND COLUMN_NAME = 'client_visible'
);
SET @stmt = IF(@col_exists = 0,
  'ALTER TABLE payment_channels ADD COLUMN client_visible TINYINT(1) NOT NULL DEFAULT 1 AFTER enabled',
  'SELECT 1');
PREPARE s FROM @stmt;
EXECUTE s;
DEALLOCATE PREPARE s;
