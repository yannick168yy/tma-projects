-- 085: 实名认证不通过的后台气泡提醒——支持"忽略"后不再计入提醒
ALTER TABLE bg_kyc
  ADD COLUMN badge_ignored TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '后台已忽略该被拒认证的气泡提醒(1=忽略); 用户重新提交时重置为0' AFTER reviewed_by;
