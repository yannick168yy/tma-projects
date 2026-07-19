-- 登录设备指纹：给登录日志加设备标识列，用于多开/薅羊毛风控
-- device_id：前端下发的长效随机 ID（localStorage+cookie 双写），最稳定
-- fp_visitor：FingerprintJS 算出的硬件指纹 hash，device_id 丢失时兜底
-- fp_signals：原始信号 JSON（GPU/屏幕/时区等），供后端做相似度匹配
ALTER TABLE bg_login_log
  ADD COLUMN device_id VARCHAR(64) NULL COMMENT '前端下发的长效设备ID' AFTER auth_method,
  ADD COLUMN fp_visitor VARCHAR(64) NULL COMMENT 'FingerprintJS 指纹hash' AFTER device_id,
  ADD COLUMN fp_signals JSON NULL COMMENT '设备原始信号' AFTER fp_visitor;

CREATE INDEX idx_login_log_device ON bg_login_log (device_id);
CREATE INDEX idx_login_log_fp ON bg_login_log (fp_visitor);

-- 注册设备锚点：查"同一台设备注册过几个号"用（薅新人礼包）
ALTER TABLE bg_user
  ADD COLUMN register_device_id VARCHAR(64) NULL COMMENT '注册时的设备ID' AFTER register_region;

CREATE INDEX idx_user_register_device ON bg_user (register_device_id);
