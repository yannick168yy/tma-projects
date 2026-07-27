-- 拉新礼金设备防薅：下载礼金领取记录补设备指纹列
-- 背景(2026-07-27 生产实测)：单IP 15号/6设备连环注册，同一设备重复领取 trial+appdl(₱38/号)
ALTER TABLE bg_app_download_claim
  ADD COLUMN device_id VARCHAR(64) NULL COMMENT '领取时设备指纹(X-Device-Id)' AFTER ip,
  ADD INDEX idx_appdl_device (device_id);
