-- 026: 三级分销体系
--
-- 新增 6 张表：
--   bg_team_node          — 用户三级归属树（注册时写入，永久不变）
--   bg_team_ggr_monthly   — 用户月度 GGR 快照（结算时从 bg_bet_order 聚合）
--   bg_team_commission    — 月度佣金分配明细（一条 GGR → 最多 3 条佣金记录）
--   bg_team_wallet        — 佣金余额账户（独立于主钱包，提现时转入主钱包）
--   bg_team_withdrawal    — 佣金提现申请
--   bg_team_config        — 佣金费率配置（单行）
--
-- 金额单位：PHP 分（BIGINT），与全库保持一致
-- 命名规范：bg_team_* 前缀，snake_case

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. bg_team_node  三级归属树
--
--    每个用户注册时写入一行。
--    l1_referrer_id = bg_user.inviter_id（直接邀请人）
--    l2_referrer_id = l1 的 inviter_id
--    l3_referrer_id = l2 的 inviter_id
--
--    activated = 0：已注册但首充未达标（不贡献 GGR 佣金给上线）
--    activated = 1：首充 ≥ min_activation_cents（配置表），上线开始获得佣金
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_team_node` (
  `user_id`            VARCHAR(32)  NOT NULL                COMMENT '当前用户',
  `l1_referrer_id`     VARCHAR(32)  NULL                    COMMENT '一级推荐人（直邀）',
  `l2_referrer_id`     VARCHAR(32)  NULL                    COMMENT '二级推荐人',
  `l3_referrer_id`     VARCHAR(32)  NULL                    COMMENT '三级推荐人',
  `activated`          TINYINT(1)   NOT NULL DEFAULT 0      COMMENT '是否已激活（首充达标）',
  `activation_cents`   BIGINT       NULL                    COMMENT '激活时的首充金额（分）',
  `activated_at`       DATETIME(3)  NULL                    COMMENT '激活时间',
  `created_at`         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  KEY `idx_l1` (`l1_referrer_id`),
  KEY `idx_l2` (`l2_referrer_id`),
  KEY `idx_l3` (`l3_referrer_id`),
  KEY `idx_activated`  (`activated`),
  CONSTRAINT `fk_tn_user`   FOREIGN KEY (`user_id`)        REFERENCES `bg_user` (`id`),
  CONSTRAINT `fk_tn_l1`     FOREIGN KEY (`l1_referrer_id`) REFERENCES `bg_user` (`id`),
  CONSTRAINT `fk_tn_l2`     FOREIGN KEY (`l2_referrer_id`) REFERENCES `bg_user` (`id`),
  CONSTRAINT `fk_tn_l3`     FOREIGN KEY (`l3_referrer_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='用户三级归属树，注册时写入，激活后上线方可获得 GGR 佣金';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. bg_team_ggr_monthly  用户月度 GGR 快照
--
--    由后台结算任务在月初（或管理员手动触发）写入上月数据。
--    数据来源：bg_bet_order（bet_type='bet' 为投注，'win' 为派彩）。
--    negative_ggr = 1 时 effective_ggr_cents = 0，不向上线分佣（平台不追债）。
--    结算完成后 settled = 1，再次触发同月视为幂等（UNIQUE KEY 保护）。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_team_ggr_monthly` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`             VARCHAR(32)     NOT NULL,
  `period`              CHAR(7)         NOT NULL             COMMENT '结算月份，如 2026-06',
  `bet_cents`           BIGINT          NOT NULL DEFAULT 0   COMMENT '当月总投注（分）',
  `win_cents`           BIGINT          NOT NULL DEFAULT 0   COMMENT '当月总派彩（分）',
  `ggr_cents`           BIGINT          NOT NULL DEFAULT 0   COMMENT 'GGR = bet - win，可为负',
  `effective_ggr_cents` BIGINT          NOT NULL DEFAULT 0   COMMENT '有效 GGR = MAX(ggr,0)，负月归零',
  `negative_ggr`        TINYINT(1)      NOT NULL DEFAULT 0   COMMENT '当月 GGR 为负（玩家赢钱月）',
  `settled`             TINYINT(1)      NOT NULL DEFAULT 0   COMMENT '佣金是否已分配完毕',
  `settled_at`          DATETIME(3)     NULL,
  `calculated_at`       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_period`   (`user_id`, `period`),
  KEY `idx_period_settled`      (`period`, `settled`),
  CONSTRAINT `fk_tgm_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='用户月度 GGR 快照，负 GGR 月份有效值归零，不向上线分佣';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. bg_team_commission  月度佣金分配明细
--
--    一条 GGR 快照产生最多 3 条佣金记录（对应 L1/L2/L3 推荐人）。
--    若推荐人不存在（用户无上线）则跳过。
--    UNIQUE KEY (beneficiary_id, from_user_id, period) 保证结算幂等。
--
--    status 流转：
--      pending  → 已计算待发放
--      paid     → 已写入 bg_team_wallet + bg_wallet_ledger
--      voided   → 因退款/异常撤销，不计入佣金
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_team_commission` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `beneficiary_id`   VARCHAR(32)     NOT NULL                COMMENT '佣金收益人（推荐人）',
  `from_user_id`     VARCHAR(32)     NOT NULL                COMMENT 'GGR 产生人（下线玩家）',
  `level`            TINYINT         NOT NULL                COMMENT '关系层级：1/2/3',
  `period`           CHAR(7)         NOT NULL                COMMENT '佣金所属月份，如 2026-06',
  `ggr_cents`        BIGINT          NOT NULL DEFAULT 0      COMMENT '下线有效 GGR（已归零处理）',
  `rate_pct`         DECIMAL(5,2)    NOT NULL                COMMENT '佣金费率（%），如 25.00',
  `commission_cents` BIGINT          NOT NULL DEFAULT 0      COMMENT '佣金金额 = ggr × rate / 100',
  `status`           ENUM('pending','paid','voided') NOT NULL DEFAULT 'pending',
  `paid_at`          DATETIME(3)     NULL,
  `created_at`       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_beneficiary_from_period` (`beneficiary_id`, `from_user_id`, `period`),
  KEY `idx_beneficiary_period`  (`beneficiary_id`, `period`),
  KEY `idx_period_status`       (`period`, `status`),
  KEY `idx_from_user`           (`from_user_id`),
  CONSTRAINT `fk_tc_beneficiary` FOREIGN KEY (`beneficiary_id`) REFERENCES `bg_user` (`id`),
  CONSTRAINT `fk_tc_from`        FOREIGN KEY (`from_user_id`)   REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='月度佣金分配明细，一条 GGR 快照最多生成 L1/L2/L3 三条记录';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. bg_team_wallet  佣金账户
--
--    独立于 bg_wallet（主玩家钱包）。
--    佣金发放时写入此表，用户发起提现申请后从此表扣款并写入主钱包。
--    version 字段用于乐观锁（防并发双花），与 bg_wallet 保持一致。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_team_wallet` (
  `user_id`             VARCHAR(32)     NOT NULL,
  `available_cents`     BIGINT          NOT NULL DEFAULT 0   COMMENT '可提现余额（分）',
  `frozen_cents`        BIGINT          NOT NULL DEFAULT 0   COMMENT '提现申请冻结中（分）',
  `lifetime_earned_cents` BIGINT        NOT NULL DEFAULT 0   COMMENT '历史累计收益（分，只增不减）',
  `version`             INT UNSIGNED    NOT NULL DEFAULT 0   COMMENT '乐观锁版本号',
  `updated_at`          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_tw_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='佣金账户，独立于主钱包，提现时转入主钱包';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. bg_team_withdrawal  佣金提现申请
--
--    用户从 bg_team_wallet 提现到 bg_wallet 的申请记录。
--    Admin 审核后：
--      approved → 扣 bg_team_wallet.frozen_cents，加 bg_wallet.available_cents，
--                 写 bg_wallet_ledger（type='bonus', ref_type='team_withdrawal'）
--      rejected → 解冻 bg_team_wallet.frozen_cents → available_cents
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_team_withdrawal` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`        VARCHAR(32)     NOT NULL,
  `amount_cents`   BIGINT          NOT NULL                  COMMENT '提现金额（分）',
  `status`         ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `admin_id`       INT             NULL                      COMMENT '审核管理员 bg_admin.id',
  `reject_reason`  VARCHAR(255)    NULL,
  `reviewed_at`    DATETIME(3)     NULL,
  `created_at`     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_user_status`   (`user_id`, `status`),
  KEY `idx_status_created` (`status`, `created_at` DESC),
  CONSTRAINT `fk_twd_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='佣金提现申请，Admin 审核后转入主钱包';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. bg_team_config  佣金费率配置（单行，id=1）
--
--    Admin 可在后台修改，修改后下次结算生效（历史已结算记录保留原费率快照）。
--    min_activation_cents：下线首充达到此金额才算激活，上线才开始获得 GGR 佣金。
--    min_withdrawal_cents：单次提现最低金额。
--    settlement_day：每月几号自动触发上月结算（0 = 仅手动）。
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `bg_team_config` (
  `id`                    INT          NOT NULL DEFAULT 1    COMMENT '单行配置，固定 id=1',
  `l1_rate_pct`           DECIMAL(5,2) NOT NULL DEFAULT 25.00 COMMENT 'L1 佣金率（%）',
  `l2_rate_pct`           DECIMAL(5,2) NOT NULL DEFAULT 8.00  COMMENT 'L2 佣金率（%）',
  `l3_rate_pct`           DECIMAL(5,2) NOT NULL DEFAULT 3.00  COMMENT 'L3 佣金率（%）',
  `min_activation_cents`  BIGINT       NOT NULL DEFAULT 10000 COMMENT '激活门槛（分），默认 ₱100',
  `min_withdrawal_cents`  BIGINT       NOT NULL DEFAULT 5000  COMMENT '最低提现额（分），默认 ₱50',
  `max_commission_per_settlement_cents` BIGINT NULL           COMMENT '单次结算单用户佣金上限，NULL=不限',
  `settlement_day`        TINYINT      NOT NULL DEFAULT 1     COMMENT '每月自动结算日（1-28），0=纯手动',
  `updated_at`            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `updated_by`            INT          NULL                   COMMENT '最后修改的 admin_id',
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_l1_rate` CHECK (`l1_rate_pct` BETWEEN 0 AND 100),
  CONSTRAINT `chk_l2_rate` CHECK (`l2_rate_pct` BETWEEN 0 AND 100),
  CONSTRAINT `chk_l3_rate` CHECK (`l3_rate_pct` BETWEEN 0 AND 100),
  CONSTRAINT `chk_settlement_day` CHECK (`settlement_day` BETWEEN 0 AND 28)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='三级分销佣金费率与结算配置（单行）';

-- 写入默认配置行（幂等）
INSERT IGNORE INTO `bg_team_config` (`id`) VALUES (1);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. bg_wallet_ledger.type ENUM 扩展见 028_wallet_ledger_team_type.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. 存量用户回填 bg_team_node
--    将已有的 bg_user.inviter_id 关系写入归属树（最多追溯三层）。
--    首次运行时一次性执行，后续注册由应用代码实时写入。
-- ─────────────────────────────────────────────────────────────────────────────
DROP PROCEDURE IF EXISTS `__backfill_026_team_node`;
DELIMITER //
CREATE PROCEDURE `__backfill_026_team_node`()
BEGIN
  -- 仅对尚未写入 bg_team_node 的用户执行
  INSERT IGNORE INTO `bg_team_node` (user_id, l1_referrer_id, l2_referrer_id, l3_referrer_id)
  SELECT
    u.id                            AS user_id,
    u.inviter_id                    AS l1_referrer_id,
    l1.inviter_id                   AS l2_referrer_id,
    l2.inviter_id                   AS l3_referrer_id
  FROM `bg_user` u
  LEFT JOIN `bg_user` l1 ON l1.id = u.inviter_id
  LEFT JOIN `bg_user` l2 ON l2.id = l1.inviter_id
  WHERE u.id NOT IN (SELECT user_id FROM `bg_team_node`);
END //
DELIMITER ;
CALL `__backfill_026_team_node`();
DROP PROCEDURE IF EXISTS `__backfill_026_team_node`;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. 存量用户激活状态回填
--    对已有首笔成功充值 ≥ ₱100 的用户，标记为已激活。
-- ─────────────────────────────────────────────────────────────────────────────
DROP PROCEDURE IF EXISTS `__backfill_026_activation`;
DELIMITER //
CREATE PROCEDURE `__backfill_026_activation`()
BEGIN
  UPDATE `bg_team_node` tn
  JOIN (
    SELECT
      user_id,
      MIN(credited_cents)  AS first_deposit_cents,
      MIN(paid_at)         AS first_paid_at
    FROM `bg_order_deposit`
    WHERE status = 'paid'
      AND credited_cents >= 10000   -- ₱100
    GROUP BY user_id
  ) q ON q.user_id = tn.user_id
  SET
    tn.activated         = 1,
    tn.activation_cents  = q.first_deposit_cents,
    tn.activated_at      = q.first_paid_at
  WHERE tn.activated = 0;
END //
DELIMITER ;
CALL `__backfill_026_activation`();
DROP PROCEDURE IF EXISTS `__backfill_026_activation`;

SET FOREIGN_KEY_CHECKS = 1;
