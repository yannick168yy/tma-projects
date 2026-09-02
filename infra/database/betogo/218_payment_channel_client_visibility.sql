-- 支付渠道客户端展示开关：关闭后不在钱包中渲染，不影响服务端路由开关
ALTER TABLE payment_channels
  ADD COLUMN client_visible TINYINT(1) NOT NULL DEFAULT 1 AFTER enabled;
