-- 195: 用户提款转人工提案支持忽略后台待办提醒
ALTER TABLE bg_withdraw_order
  ADD COLUMN badge_ignored TINYINT(1) NOT NULL DEFAULT 0
    COMMENT '后台已忽略该提款转人工提案提醒(1=忽略)' AFTER handled_at;
