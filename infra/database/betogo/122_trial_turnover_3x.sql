-- 对齐 trial 体验金流水口径：历史默认 0x 意味着体验金可直接提现（资损口子），
-- 统一为 3x（与活动展示口径一致）。仅覆盖仍为 0 的旧值，后台改过的不动。
UPDATE `bg_promo_config`
   SET `config_value` = '3'
 WHERE `promo_id` = 'trial'
   AND `config_key` = 'turnover_x'
   AND `config_value` = '0';
