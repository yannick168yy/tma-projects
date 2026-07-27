-- 178: 扩宽 568Win 报表注单 ref_no 列
-- 起因：SeamlessGame 报表同步自 2026-07-24 起卡死，core-node 每轮报
--   "Data too long for column 'ref_no' (errno 1406)"。
--   568Win 体育/组合注单的 refNo 会超过 64 字符，一条超长导致整批 INSERT 失败、
--   同步游标不前进，上游对账审核规则连带 skipped。
-- 修复：把 ref_no 从 VARCHAR(64) 扩到 VARCHAR(191)（utf8mb4 索引安全上限，
--   与 portfolio(32) 组成的 uk_portfolio_ref 不超 InnoDB 前缀限制）。
SET NAMES utf8mb4;

ALTER TABLE `bg_568win_report_bet`
  MODIFY `ref_no` VARCHAR(191) NOT NULL COMMENT '568Win RefNo';
