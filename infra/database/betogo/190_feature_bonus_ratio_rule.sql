-- 190: 新审核规则 feature_bonus_ratio（feature彩金倍数）
-- 背景：bonus_bet_abuse 只管平台活动彩金(IsGameProviderPromotion=true)，而生产 100% 的 bonus
--       都是游戏内 feature 派彩(=false)、被它排除。派彩时已有自动流水闸兜底，这里在「提现时」
--       再兜一层：窗口内 feature 派彩总额 ÷ 历史累计真实存款 ≥ threshold 倍即转人工。
--       默认 5（如 BG-10712 存500赢6375=12.75x 会命中），运营可在后台「审核策略」调；无真实存款时跳过。
SET NAMES utf8mb4;

INSERT IGNORE INTO bg_withdraw_review_config (rule_code, scope, enabled, threshold, params) VALUES
  ('feature_bonus_ratio', 'user', 1, 5, NULL);
