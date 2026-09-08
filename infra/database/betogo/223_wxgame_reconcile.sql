-- WXGame 对账：拉上游 get_game_history_list 与本地 bg_bet_round 逐局比对。
--
-- 为什么必须做：无缝钱包下钱是上游回调时实时扣的，一旦回调丢了（网络超时、我方重启、
-- nginx 拒了），玩家在游戏里已经输赢完毕、我方账上却没有这一笔，且**双方都不会报错**。
-- 只有主动比对才能发现。

-- 游标。不用「每次扫最近 N 小时」是因为那样漏了就永远漏了；
-- 记住扫到哪，配合重叠窗口，晚到的记录下一轮还能被捞回来。
CREATE TABLE IF NOT EXISTS `bg_wxgame_recon_cursor` (
  `id`             TINYINT      NOT NULL DEFAULT 1,
  `next_time_utc`  BIGINT       NULL COMMENT '上游游标：秒级时间戳',
  `next_id`        BIGINT       NULL COMMENT '上游游标：记录ID',
  `last_run_at`    DATETIME(3)  NULL,
  `last_scanned`   INT          NOT NULL DEFAULT 0 COMMENT '上轮扫描条数',
  `last_error`     VARCHAR(512) NULL,
  `updated_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  CONSTRAINT `ck_recon_cursor_single` CHECK (`id` = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='WXGame 对账游标';

-- 差异明细。不自动修钱：金额对不上时到底以谁为准要人判断，
-- 自动补账在对账逻辑本身有 bug 时会放大损失。这里只负责让差异可见、可追踪。
CREATE TABLE IF NOT EXISTS `bg_wxgame_recon_diff` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `round_id`       VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  `transaction_id` VARCHAR(128) COLLATE utf8mb4_bin NULL COMMENT '上游下注交易ID',
  `player_id`      VARCHAR(64)  NULL,
  `user_id`        VARCHAR(32)  NULL COMMENT '解析得到的本地用户，解析不出为 NULL',
  `diff_type`      ENUM('missing_local','amount_mismatch','missing_upstream','status_mismatch') NOT NULL,
  `upstream_bet`   DECIMAL(18,4) NULL,
  `upstream_win`   DECIMAL(18,4) NULL,
  `upstream_status` VARCHAR(32)  NULL,
  `local_bet`      DECIMAL(18,4) NULL,
  `local_win`      DECIMAL(18,4) NULL,
  `detail`         JSON         NULL COMMENT '上游原始记录，人工核对用',
  `resolved_at`    DATETIME(3)  NULL COMMENT '人工处理完的时间',
  `resolved_note`  VARCHAR(512) NULL,
  `created_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  -- 同一局同一类差异只留一行：重叠窗口会反复扫到同一条，不去重会刷屏
  UNIQUE KEY `uk_round_type` (`round_id`, `diff_type`),
  KEY `idx_unresolved` (`resolved_at`, `created_at`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='WXGame 对账差异';
