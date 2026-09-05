-- P2-1 计费与账户表：分成方案、日切快照、账单、租户额度账户。
--
-- 结算币种统一 USDT：租户可能同时跑 PHP / IDR 市场，账单不折算成一个币种就没法结。
-- 折算率取当日快照（bi_daily_exchange_rate），不用结算时的实时汇率 —— 否则同一天的
-- 同一笔流水，账单生成早晚不同金额就不同，这是包网最容易扯皮的第二个点（第一是 GGR 口径）。
SET NAMES utf8mb4;

-- ── 分成方案 ─────────────────────────────────────────────────────────────
-- 与 pf_plan（功能套餐）分开：功能套餐决定客户能用哪些玩法，分成方案决定怎么收钱。
-- 两者常见组合是「旗舰版功能 + 低分成」，塞进一张表就必然出现互相牵连的改动。
CREATE TABLE IF NOT EXISTS `pf_billing_plan` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`        VARCHAR(32)  NOT NULL,
  `name`        VARCHAR(64)  NOT NULL,
  `description` VARCHAR(255) NULL,
  -- sum      = 月费与分成叠加收
  -- max_of_fee = max(月费, 分成合计)，即月费是保底而非附加
  `settle_mode` ENUM('sum','max_of_fee') NOT NULL DEFAULT 'sum',
  `settle_currency` VARCHAR(16) NOT NULL DEFAULT 'USDT',
  `period`      ENUM('monthly','semi_monthly','weekly') NOT NULL DEFAULT 'monthly' COMMENT '账单周期',
  `enabled`     TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_billing_plan_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='分成方案';

-- 一个方案由多条规则组合叠加。四种类型可任意共存（如 月费保底 + GGR 分成）。
CREATE TABLE IF NOT EXISTS `pf_billing_rule` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `billing_plan_id` INT UNSIGNED NOT NULL,
  `rule_type`       ENUM('deposit_commission','ggr_share','turnover_rebate','monthly_fee') NOT NULL,
  `label`           VARCHAR(64)  NOT NULL COMMENT '账单上给客户看的名字，如「充值佣金 3%」',
  `rate_pct`        DECIMAL(8,4) NULL COMMENT '单一费率（%）。用 tiers 时忽略',
  `fixed_amount`    DECIMAL(18,4) NULL COMMENT 'monthly_fee 的月费金额（结算币种）',
  -- [{"upTo": 100000, "ratePct": 3}, {"upTo": null, "ratePct": 2.5}]
  `tiers`           JSON NULL COMMENT '分档费率，upTo=null 表示最高档',
  -- flat        = 达到哪档就整体按该档费率
  -- progressive = 逐档累进，每一段用各自费率
  `tier_mode`       ENUM('flat','progressive') NOT NULL DEFAULT 'flat',
  -- 混用双资金模式时，两种模式常谈不同费率：platform 抽水高（平台承担资金压力），tenant 低
  `scope`           ENUM('all','platform','tenant') NOT NULL DEFAULT 'all',
  -- ↓ GGR 口径三参数。签约时逐租户确认，账单上逐项展开，不给争议留空间
  `deduct_bonus`      TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'GGR 是否扣活动成本',
  `deduct_commission` TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'GGR 是否扣团队佣金',
  `deduct_channel_fee` TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'GGR 是否扣通道手续费（仅模式 A 有）',
  `carry_over`        TINYINT(1) NOT NULL DEFAULT 1 COMMENT '负 GGR 是否结转下期',
  -- {"slots": 0.8, "live": 0.5} —— 分场馆流水返点，键为 bi_daily_provider.provider
  `venue_rates`     JSON NULL COMMENT 'turnover_rebate 分场馆费率（%），缺省用 rate_pct',
  `sort_order`      INT NOT NULL DEFAULT 100,
  `enabled`         TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_rule_plan` (`billing_plan_id`, `enabled`),
  CONSTRAINT `fk_billing_rule_plan` FOREIGN KEY (`billing_plan_id`) REFERENCES `pf_billing_plan` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='分成规则';

-- 租户挂的分成方案（含历史）。换方案给旧记录填 ended_at，账单要能重算出当期用的是哪套规则。
CREATE TABLE IF NOT EXISTS `pf_tenant_billing_plan` (
  `tenant_id`       INT UNSIGNED NOT NULL,
  `billing_plan_id` INT UNSIGNED NOT NULL,
  `started_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `ended_at`        DATETIME(3) NULL COMMENT 'NULL=当前生效',
  PRIMARY KEY (`tenant_id`, `billing_plan_id`, `started_at`),
  KEY `idx_tbp_current` (`tenant_id`, `ended_at`),
  CONSTRAINT `fk_tbp_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`),
  CONSTRAINT `fk_tbp_plan` FOREIGN KEY (`billing_plan_id`) REFERENCES `pf_billing_plan` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户分成方案（含历史）';

-- ── 日切快照（P2-4）────────────────────────────────────────────────────────
-- 🔴 快照一旦 locked_at 非空就不可变：规则改动只影响未来周期。
-- 允许重算的只有当天与前两天（对齐 BI 回填窗口），锁定后重算要人工授权。
CREATE TABLE IF NOT EXISTS `pf_billing_daily` (
  `tenant_id`   INT UNSIGNED NOT NULL,
  `stat_date`   DATE NOT NULL COMMENT '租户统计日（与租户库 bi_daily_* 同口径）',
  `currency`    VARCHAR(16) NOT NULL COMMENT '原币',
  `fx_rate_usdt` DECIMAL(24,12) NOT NULL DEFAULT 1 COMMENT '1 原币折合 USDT，取当日快照',
  `deposit_amount`  DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '成功充值（原币）',
  `deposit_platform` DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '其中走平台通道的部分',
  `deposit_tenant`   DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '其中走租户自带通道的部分',
  `deposit_count`   INT NOT NULL DEFAULT 0,
  `withdraw_amount` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `withdraw_platform` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `withdraw_tenant`   DECIMAL(18,4) NOT NULL DEFAULT 0,
  `turnover`        DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '有效投注流水',
  `payout`          DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '派彩',
  `ggr`             DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '有效投注 - 派彩，可为负',
  `bonus_cost`      DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '活动成本',
  `commission_cost` DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '团队佣金成本',
  `channel_fee`     DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '通道手续费，只有平台通道才有',
  `venue_turnover`  JSON NULL COMMENT '{场馆: 流水}，分场馆返点用',
  `channel_detail`  JSON NULL COMMENT '{通道: {owner, amount, fee}}，对账依据',
  `locked_at`       DATETIME(3) NULL COMMENT '非空=已锁定，不可再重算',
  `computed_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenant_id`, `stat_date`, `currency`),
  KEY `idx_billing_daily_date` (`stat_date`),
  CONSTRAINT `fk_billing_daily_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='每日计费快照（锁定后不可变）';

-- ── 账单（P2-5）──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pf_invoice` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `invoice_no`      VARCHAR(32) NOT NULL COMMENT '对客户可见的单号，如 INV-202609-demo1',
  `tenant_id`       INT UNSIGNED NOT NULL,
  `billing_plan_id` INT UNSIGNED NULL COMMENT '生成时挂的方案，方案后来改了也知道当期按什么算的',
  `period_start`    DATE NOT NULL,
  `period_end`      DATE NOT NULL COMMENT '含当日',
  `currency`        VARCHAR(16) NOT NULL DEFAULT 'USDT',
  `carry_in`        DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '上期结转的负 GGR（负数）',
  `carry_out`       DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '结转到下期的负 GGR（负数）',
  `gross_amount`    DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '规则算出的合计',
  `adjust_amount`   DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '人工调整，带审计',
  `total_amount`    DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT 'gross + adjust，实际应收',
  `status`          ENUM('draft','issued','confirmed','disputed','settled','void') NOT NULL DEFAULT 'draft',
  `dispute_reason`  VARCHAR(512) NULL,
  `note`            VARCHAR(512) NULL,
  `issued_at`       DATETIME(3) NULL,
  `confirmed_at`    DATETIME(3) NULL,
  `settled_at`      DATETIME(3) NULL,
  `created_by`      INT UNSIGNED NULL COMMENT 'pf_admin.id',
  `created_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_invoice_no` (`invoice_no`),
  -- 同一租户同一周期只能有一张账单，重复生成直接撞唯一键
  UNIQUE KEY `uk_invoice_period` (`tenant_id`, `period_start`, `period_end`),
  KEY `idx_invoice_status` (`status`, `period_end`),
  CONSTRAINT `fk_invoice_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='结算单';

-- 账单逐项展开：基数、费率、分档过程都要能追溯，客户问「这 3800 怎么来的」要当场答得出
CREATE TABLE IF NOT EXISTS `pf_invoice_item` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `invoice_id` INT UNSIGNED NOT NULL,
  `rule_type`  VARCHAR(32) NOT NULL,
  `label`      VARCHAR(64) NOT NULL,
  `basis_amount` DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '计费基数（结算币种）',
  `rate_pct`   DECIMAL(8,4) NULL,
  `amount`     DECIMAL(18,4) NOT NULL DEFAULT 0,
  `detail`     JSON NULL COMMENT '分档明细、扣减项明细、场馆拆分',
  `sort_order` INT NOT NULL DEFAULT 100,
  PRIMARY KEY (`id`),
  KEY `idx_item_invoice` (`invoice_id`),
  CONSTRAINT `fk_item_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `pf_invoice` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='结算单明细';

-- ── 租户额度账户（P2-6）───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `pf_tenant_account` (
  `tenant_id`     INT UNSIGNED NOT NULL,
  `currency`      VARCHAR(16) NOT NULL DEFAULT 'USDT',
  `balance`       DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '账户余额，可为负（欠款）',
  `deposit_amount` DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '押金，不可用于日常扣划',
  `credit_limit`  DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '授信额度',
  -- 三级降级的触发线（余额+授信 低于此值时逐级降级），留空用平台默认
  `warn_threshold` DECIMAL(18,4) NULL COMMENT '预警线',
  `updated_at`    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenant_id`, `currency`),
  CONSTRAINT `fk_account_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户额度账户';

-- 🔴 只 INSERT，永不 UPDATE / DELETE。出纠纷时这张表是唯一事实依据。
CREATE TABLE IF NOT EXISTS `pf_tenant_ledger` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`  INT UNSIGNED NOT NULL,
  `currency`   VARCHAR(16) NOT NULL DEFAULT 'USDT',
  `biz_type`   ENUM('margin_in','margin_out','invoice_settle','manual_adjust','payout','collect','credit_change') NOT NULL,
  `amount`     DECIMAL(18,4) NOT NULL COMMENT '正=账户增加，负=账户减少',
  `balance_after` DECIMAL(18,4) NOT NULL,
  `ref_type`   VARCHAR(32) NULL COMMENT 'invoice / withdraw_order / deposit_order',
  `ref_id`     VARCHAR(64) NULL,
  `remark`     VARCHAR(255) NULL,
  `operator_id` INT UNSIGNED NULL COMMENT 'pf_admin.id，系统写入为 NULL',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_ledger_tenant` (`tenant_id`, `created_at`),
  -- 同一笔业务只能记一次账：代付重试、账单重复核销都靠这个唯一键挡住
  UNIQUE KEY `uk_ledger_ref` (`tenant_id`, `biz_type`, `ref_type`, `ref_id`),
  CONSTRAINT `fk_ledger_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户额度流水（不可变）';

-- 额度不足不自动拒绝、不平台垫付 —— 转人工队列（已定的决策）
CREATE TABLE IF NOT EXISTS `pf_manual_queue` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `tenant_id`  INT UNSIGNED NOT NULL,
  `kind`       ENUM('payout_insufficient','invoice_overdue','settle_failed') NOT NULL,
  `ref_type`   VARCHAR(32) NULL,
  `ref_id`     VARCHAR(64) NULL,
  `currency`   VARCHAR(16) NOT NULL DEFAULT 'USDT',
  `amount`     DECIMAL(18,4) NOT NULL DEFAULT 0,
  `reason`     VARCHAR(512) NOT NULL,
  `status`     ENUM('pending','resolved','rejected') NOT NULL DEFAULT 'pending',
  `resolved_by` INT UNSIGNED NULL,
  `resolved_at` DATETIME(3) NULL,
  `note`       VARCHAR(512) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_queue_ref` (`kind`, `ref_type`, `ref_id`),
  KEY `idx_queue_status` (`status`, `created_at`),
  CONSTRAINT `fk_queue_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='人工处理队列';

-- 通道费率：模式 A 的手续费要进 GGR 扣减项，没有费率就算不出净收益
ALTER TABLE `pf_tenant_channel`
  ADD COLUMN `fee_rate_pct` DECIMAL(8,4) NOT NULL DEFAULT 0 COMMENT '通道费率（%）' AFTER `owner`,
  ADD COLUMN `fee_fixed` DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT '每笔固定手续费' AFTER `fee_rate_pct`;

-- 种子：三档分成方案。费率是常见起谈价，签约时逐户调。
INSERT INTO `pf_billing_plan` (`code`, `name`, `description`, `settle_mode`) VALUES
  ('rev_share_std', '标准分成', 'GGR 30% + 充值佣金 1%，无月费', 'sum'),
  ('rev_share_pro', '进阶分成', 'GGR 25% + 月费 500 USDT 保底', 'max_of_fee'),
  ('fee_only',     '纯月费',   '月费 2000 USDT，不参与分成', 'sum')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

INSERT INTO `pf_billing_rule`
  (`billing_plan_id`, `rule_type`, `label`, `rate_pct`, `fixed_amount`, `sort_order`)
SELECT p.id, 'ggr_share', 'GGR 分成 30%', 30.0000, NULL, 10 FROM `pf_billing_plan` p WHERE p.code = 'rev_share_std'
UNION ALL
SELECT p.id, 'deposit_commission', '充值佣金 1%', 1.0000, NULL, 20 FROM `pf_billing_plan` p WHERE p.code = 'rev_share_std'
UNION ALL
SELECT p.id, 'ggr_share', 'GGR 分成 25%', 25.0000, NULL, 10 FROM `pf_billing_plan` p WHERE p.code = 'rev_share_pro'
UNION ALL
SELECT p.id, 'monthly_fee', '月费保底 500 USDT', NULL, 500.0000, 90 FROM `pf_billing_plan` p WHERE p.code = 'rev_share_pro'
UNION ALL
SELECT p.id, 'monthly_fee', '月费 2000 USDT', NULL, 2000.0000, 90 FROM `pf_billing_plan` p WHERE p.code = 'fee_only';
