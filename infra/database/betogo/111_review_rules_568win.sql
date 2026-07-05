-- 111: 568Win 数据反哺审核规则（P0）
-- ① bg_568win_report_bet 按 ref_no 对账需要独立索引（现有唯一键 (portfolio, ref_no) 前缀不可用）
-- ② 三条新审核规则默认配置：
--    upstream_reconcile  上游对账（user+team）：本地已结算注单与 568Win 报表按 refNo 核对
--    bonus_bet_abuse     彩金滥用（user）：窗口内上游 Bonus 入账金额/笔数异常
--    cancel_pattern      取消异常（user）：窗口内 Void 注单绝对数与占比双超标
SET NAMES utf8mb4;

ALTER TABLE bg_568win_report_bet ADD KEY idx_ref_no (ref_no);

INSERT IGNORE INTO bg_withdraw_review_config (rule_code, scope, enabled, threshold, params) VALUES
  ('upstream_reconcile', 'user', 1, NULL, JSON_OBJECT('graceMinutes', 30)),
  ('upstream_reconcile', 'team', 1, NULL, JSON_OBJECT('graceMinutes', 30)),
  ('bonus_bet_abuse',    'user', 1, 200000, JSON_OBJECT('count', 30)),
  ('cancel_pattern',     'user', 1, 10, JSON_OBJECT('ratio', 0.3));
