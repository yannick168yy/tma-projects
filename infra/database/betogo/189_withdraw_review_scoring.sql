-- 189: 提现审核「综合评分」策略(弱关联信号加权,先影子模式)
--
-- 现状:任一规则命中即转人工(硬 OR)。same_device_fp 等单一弱信号(同型号撞纹/CGNAT 同 IP)
-- 单独命中就把正常用户卷进人工队列 → 误伤面大。
--
-- 本策略把「弱关联类」四条规则改为累加权重评分,总分 ≥ threshold 才转人工;
-- 其余规则(资金红线、篡改、KYC、以及 withdraw_account_reuse 收款账号复用)仍是硬闸门,命中即转人工。
--
-- shadow=1:影子模式,只记录新评分结果(写入 review_snapshot),判定仍走旧 OR 逻辑,不改变任何放行行为。
-- 观察 shadowWouldChange 的单子、抽查确认误放率可接受后,再把 shadow 改 0 正式生效。
--
-- 权重与阈值可后台/直接改库调整。account_reuse 刻意不在 weights 内 —— 保留硬闸门。

INSERT IGNORE INTO bg_withdraw_review_config (rule_code, scope, enabled, threshold, params) VALUES
  ('_score_policy', 'user', 1, 100, JSON_OBJECT(
    'shadow', 1,
    'weights', JSON_OBJECT(
      'withdraw_owner_reuse', 60,
      'same_device_id',       50,
      'same_device_fp',       35,
      'same_ip',              25)));
