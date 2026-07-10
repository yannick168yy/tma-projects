-- 风控模块地基（区别于「取款审核」：审核是人工复核单笔订单，风控是自动化识别与拦截「人」）。
-- 四张表：标签（画像沉淀）、信号快照（每日重算）、策略（checkpoint × 规则 → 动作）、命中日志。

-- 用户标签：风控产出沉淀在「人」身上，可累积、可回溯、可申诉。
-- 人工标优先于自动标：cron 只能 upsert source='auto' 的行，绝不覆盖/删除 source='manual'。
CREATE TABLE IF NOT EXISTS `bg_user_tag` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     VARCHAR(32)  NOT NULL,
  `tag_code`    VARCHAR(48)  NOT NULL COMMENT 'risk.bonus_abuse | risk.multi_account | risk.arbitrage ...',
  `source`      ENUM('auto','manual') NOT NULL DEFAULT 'auto' COMMENT '自动跑批 / 运营人工',
  `confidence`  TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0-100，manual 恒为 100',
  `evidence`    JSON NULL COMMENT '命中时的具体数值，供运营复核与用户申诉',
  `assigned_by` VARCHAR(64)  NULL COMMENT 'manual 时的管理员用户名',
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_tag` (`user_id`, `tag_code`),
  KEY `idx_tag_code` (`tag_code`),
  KEY `idx_source` (`source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户风控标签（人工优先于自动）';

-- 用户风险信号快照：每日 cron 全量重算，一行/用户。宽表便于后台按分数/比值筛人。
-- 与 bg_user_segment（价值分层）互补，不重复其 lifecycle/value_tier 维度。
CREATE TABLE IF NOT EXISTS `bg_user_risk_signal` (
  `user_id`             VARCHAR(32)   NOT NULL,
  `bonus_total`         DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '累计彩金（trial+firstdep+appdl+task现金+转盘，PHP）',
  `net_deposit`         DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT '累计成功充值（PHP）',
  `bonus_ratio`         DECIMAL(10,4) NOT NULL DEFAULT 0 COMMENT '彩金/充值，无充值且有彩金时为 9999',
  `withdraw_count`      INT           NOT NULL DEFAULT 0 COMMENT '成功提现笔数',
  `device_shared_users` INT           NOT NULL DEFAULT 1 COMMENT '同 device_id 关联的账号数',
  `ip_shared_users`     INT           NOT NULL DEFAULT 1 COMMENT '同 IP 关联的账号数',
  `risk_score`          TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0-100 综合风险分',
  `signals`             JSON NULL COMMENT '原始明细快照',
  `computed_at`         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  KEY `idx_risk_score` (`risk_score`),
  KEY `idx_bonus_ratio` (`bonus_ratio`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户风险信号快照（每日重算）';

-- 风控策略：某个管控点命中某条规则时做什么。
-- action 语义：tag_only=影子模式只记录不干预 | limit=限制 | deny=直接拒绝 | escalate=转人工审核队列
CREATE TABLE IF NOT EXISTS `bg_risk_policy` (
  `checkpoint` VARCHAR(32) NOT NULL COMMENT 'login | promo_claim | withdraw',
  `rule_code`  VARCHAR(48) NOT NULL,
  `action`     ENUM('tag_only','limit','deny','escalate') NOT NULL DEFAULT 'tag_only',
  `enabled`    TINYINT(1)  NOT NULL DEFAULT 1,
  `params`     JSON NULL COMMENT '规则阈值，如 {"minRatio":1.5}',
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`checkpoint`, `rule_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='风控策略：管控点 × 规则 → 动作';

-- 风控命中日志：tag_only 也要落，否则影子模式期无法评估误报率。
CREATE TABLE IF NOT EXISTS `bg_risk_hit_log` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       VARCHAR(32)  NULL COMMENT '登录前拦截时可能为空',
  `checkpoint`    VARCHAR(32)  NOT NULL,
  `rule_code`     VARCHAR(48)  NOT NULL,
  `action`        ENUM('tag_only','limit','deny','escalate') NOT NULL,
  `matched_value` VARCHAR(128) NULL COMMENT '命中的具体值，如被封的 IP',
  `detail`        JSON NULL,
  `ip`            VARCHAR(64)  NULL,
  `device_id`     VARCHAR(128) NULL,
  `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_user_created` (`user_id`, `created_at`),
  KEY `idx_checkpoint_created` (`checkpoint`, `created_at`),
  KEY `idx_action` (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='风控命中日志';

-- 策略种子。名单是人工明确加的，意图清晰，直接 deny；
-- 行为规则一律先 tag_only 影子模式，待运营复核误报率后再由后台逐条开 deny。
INSERT IGNORE INTO `bg_risk_policy` (`checkpoint`, `rule_code`, `action`, `enabled`, `params`) VALUES
  ('login',       'blacklist_user',   'deny',     1, NULL),
  ('login',       'blacklist_ip',     'deny',     1, NULL),
  ('login',       'blacklist_device', 'deny',     1, NULL),
  ('login',       'blacklist_region', 'deny',     1, NULL),
  ('promo_claim', 'blacklist_user',   'deny',     1, NULL),
  ('promo_claim', 'blacklist_ip',     'deny',     1, NULL),
  ('promo_claim', 'blacklist_device', 'deny',     1, NULL),
  ('promo_claim', 'bonus_abuse',      'tag_only', 1, '{"minRatio": 1.5, "minWithdrawCount": 1}'),
  ('promo_claim', 'multi_account',    'tag_only', 1, '{"minSharedUsers": 3}'),
  ('withdraw',    'blacklist_user',   'escalate', 1, NULL),
  ('withdraw',    'blacklist_ip',     'escalate', 1, NULL),
  ('withdraw',    'blacklist_device', 'escalate', 1, NULL),
  ('withdraw',    'bonus_abuse',      'tag_only', 1, '{"minRatio": 1.5, "minWithdrawCount": 1}'),
  ('withdraw',    'multi_account',    'tag_only', 1, '{"minSharedUsers": 3}');

-- 审核引擎读风控结论的规则。不在 bg_withdraw_review_config 里 seed 就永远是 skipped。
INSERT IGNORE INTO `bg_withdraw_review_config` (`rule_code`, `scope`, `enabled`, `threshold`, `params`) VALUES
  ('risk_hit', 'user', 1, NULL, JSON_OBJECT('windowMins', 10));
