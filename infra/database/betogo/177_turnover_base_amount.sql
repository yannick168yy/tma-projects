-- 流水要求表增加本金列：存款=入账金额，优惠=彩金入账额
-- 用途：可提额模型（可提现金额 = 余额 - 未解锁彩金本金），存款不再被彩金流水墙连坐
ALTER TABLE bg_turnover_requirements
  ADD COLUMN base_amount DECIMAL(18,4) NULL COMMENT '本金：存款入账额或彩金入账额' AFTER source_ref;

-- 回填存款类：required_amount 即 1 倍本金
UPDATE bg_turnover_requirements
SET base_amount = required_amount
WHERE base_amount IS NULL AND source_type = 'deposit';

-- 回填优惠类：按当前配置的 turnover_x 反推本金；查不到倍数时保守取 required_amount（多锁不少锁）
UPDATE bg_turnover_requirements r
LEFT JOIN bg_promo_config c
  ON c.config_key = 'turnover_x'
 AND c.promo_id = CASE
     WHEN r.source_ref = 'trial' THEN 'trial'
     WHEN r.source_ref = 'appdl' THEN 'appdl'
     WHEN r.source_ref = 'referral' THEN 'referral'
     WHEN r.source_ref = 'firstdep' THEN 'firstdep'
     WHEN r.source_ref LIKE 'redep:%' THEN 'redep'
     ELSE NULL END
SET r.base_amount = CASE
    WHEN c.config_value IS NOT NULL AND CAST(c.config_value AS DECIMAL(18,4)) > 0
      THEN ROUND(r.required_amount / CAST(c.config_value AS DECIMAL(18,4)), 4)
    ELSE r.required_amount END
WHERE r.base_amount IS NULL AND r.source_type = 'promotion';
