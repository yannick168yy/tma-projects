-- 常规复充改为每档独立流水，并上线中、大额充值阶梯。
SET NAMES utf8mb4;

INSERT INTO `bg_promo_config` (`promo_id`, `config_key`, `config_value`) VALUES
  ('redep_regular', 'enabled', '1'),
  ('redep_regular', 'tiers', '{"PHP":[{"depositAmount":500,"bonusAmount":50,"turnoverX":25},{"depositAmount":1000,"bonusAmount":120,"turnoverX":28},{"depositAmount":2000,"bonusAmount":280,"turnoverX":30},{"depositAmount":3000,"bonusAmount":450,"turnoverX":32},{"depositAmount":5000,"bonusAmount":850,"turnoverX":33},{"depositAmount":10000,"bonusAmount":1800,"turnoverX":34},{"depositAmount":20000,"bonusAmount":3800,"turnoverX":35},{"depositAmount":50000,"bonusAmount":10000,"turnoverX":35}],"IDR":[{"depositAmount":100000,"bonusAmount":10000,"turnoverX":25},{"depositAmount":200000,"bonusAmount":24000,"turnoverX":28},{"depositAmount":500000,"bonusAmount":70000,"turnoverX":30},{"depositAmount":1000000,"bonusAmount":170000,"turnoverX":33},{"depositAmount":2000000,"bonusAmount":380000,"turnoverX":35},{"depositAmount":5000000,"bonusAmount":1000000,"turnoverX":35}],"USDT":[{"depositAmount":20,"bonusAmount":2,"turnoverX":25},{"depositAmount":50,"bonusAmount":6,"turnoverX":28},{"depositAmount":100,"bonusAmount":14,"turnoverX":30},{"depositAmount":200,"bonusAmount":34,"turnoverX":33},{"depositAmount":500,"bonusAmount":95,"turnoverX":35},{"depositAmount":1000,"bonusAmount":200,"turnoverX":35}],"USDC":[{"depositAmount":20,"bonusAmount":2,"turnoverX":25},{"depositAmount":50,"bonusAmount":6,"turnoverX":28},{"depositAmount":100,"bonusAmount":14,"turnoverX":30},{"depositAmount":200,"bonusAmount":34,"turnoverX":33},{"depositAmount":500,"bonusAmount":95,"turnoverX":35},{"depositAmount":1000,"bonusAmount":200,"turnoverX":35}]}'),
  ('redep_regular', 'turnover_x', '25'),
  ('redep_regular', 'daily_bonus_caps', '{"PHP":10000,"IDR":1000000,"USDT":200,"USDC":200}'),
  ('redep_regular', 'stack_with_limited', '0')
ON DUPLICATE KEY UPDATE `config_value` = VALUES(`config_value`);
