-- 182: 领奖白名单——命中即完全放行拉新礼金设备防薅，供己方测试机反复领优惠。
-- 与风控黑名单(bg_risk_blacklist)相对：黑名单拦人，白名单放行。仅作用于 trial/appdl 领取的设备去重
-- 与注册连环检测(不误打 multi_account 标签)，不影响提现审核等其它风控。
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS bg_promo_claim_whitelist (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  type        ENUM('device','ip','user') NOT NULL COMMENT 'device=X-Device-Id或硬件指纹, ip=出口IP, user=用户ID',
  value       VARCHAR(128)  NOT NULL,
  note        VARCHAR(255)  NULL COMMENT '备注，如"测试机-yannick"',
  created_by  VARCHAR(64)   NULL,
  created_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_type_value (type, value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='领奖白名单(测试机放行)';
