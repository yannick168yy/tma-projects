-- 演示站标记。这类租户的数据是脱敏样本，不能参与任何跨租户机制：
-- 定时任务（会真的发 TG 广播、拿假订单号查支付商、调代付撤销）、
-- 风控联防（假用户进平台名单会误伤真实租户）、
-- 平台 BI 抽数与计费日切（假数据污染平台报表与账单）。
--
-- 用标记而不是硬编码租户 id：以后开销售试用站、压测站都复用同一个口径。
ALTER TABLE pf_tenant
  ADD COLUMN is_demo TINYINT(1) NOT NULL DEFAULT 0
  COMMENT '演示站：1=不参与定时任务/风控联防/BI抽数/计费日切' AFTER self_operated;
