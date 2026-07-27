-- 183: 用户提现审核口径由「分」统一为「元」，配套把绝对金额阈值 ÷100。
-- 背景：withdraw-review.service 之前把 profit/deposit 等折成分，与 depositCents 同口径；现全部改元
--       （数据源 deposit/bet/ledger.amount 本就是元 DECIMAL，去掉人为 *100）。
--       只影响「绝对金额」阈值的规则；倍数/计数类(high_multiple_profit、withdraw_deposit_ratio、
--       same_ip_device、bonus_bet_abuse 的 count)不受单位影响，无需动。
-- 团队佣金审核(scope=team)保持分不变(其钱字段 amount_cents/commission_cents 是数据库真·分列)。
SET NAMES utf8mb4;

-- 用户域绝对金额阈值 ÷100（原分 → 元）：净盈利、优惠总额、上游彩金金额
UPDATE bg_withdraw_review_config
   SET threshold = threshold / 100
 WHERE scope = 'user'
   AND rule_code IN ('large_profit', 'total_bonus', 'bonus_bet_abuse')
   AND threshold IS NOT NULL;
