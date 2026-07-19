-- 035: 活动配置表，存 trial/referral/firstdep 的可配置数值
CREATE TABLE IF NOT EXISTS `bg_promo_config` (
  `promo_id`     VARCHAR(32)  NOT NULL,
  `config_key`   VARCHAR(64)  NOT NULL,
  `config_value` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`promo_id`, `config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='促销活动可配置参数';

INSERT INTO `bg_promo_config` (`promo_id`, `config_key`, `config_value`) VALUES
  ('trial',    'amount',         '88'),
  ('trial',    'enabled',        '1'),
  ('referral', 'inviter_amount', '50'),
  ('referral', 'invitee_amount', '30'),
  ('referral', 'enabled',        '1'),
  ('firstdep', 'match_pct',      '120'),
  ('firstdep', 'max_bonus',      '1000'),
  ('firstdep', 'min_deposit',    '100'),
  ('firstdep', 'turnover_x',     '15'),
  ('firstdep', 'enabled',        '1')
ON DUPLICATE KEY UPDATE `config_value` = VALUES(`config_value`);
