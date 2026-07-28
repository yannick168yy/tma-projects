-- 拉新礼金「同设备指纹已领账号数」阈值可配置。
-- 载体：bg_risk_policy 的 promo_claim/promo_device_dedup 行，params.fpClaimThreshold。
-- 该 rule_code 不参与 risk.service 的 evalBehaviourRule（会被 skip，不触发/不记日志），
-- 仅由 promo-device-guard.service 读取；后台 /policies 可直接改 params。
-- 默认 2，与历史写死值一致，上线行为不变。
INSERT IGNORE INTO `bg_risk_policy` (`checkpoint`, `rule_code`, `action`, `enabled`, `params`) VALUES
  ('promo_claim', 'promo_device_dedup', 'deny', 1, '{"fpClaimThreshold": 2}');
