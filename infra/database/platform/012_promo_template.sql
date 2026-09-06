-- P3-3 活动模板市场：把「已经验证过的活动参数组合」存成模板，开新站或改活动时一键套用。
--
-- 模板 = 一套 PromoConfig 参数（可以只含其中几个区块），不是任意活动 DSL。
-- 为什么不做通用活动引擎：现有 8 类活动的领取条件、流水锁、结算时机各不相同
-- （首充一次性、复充有窗口与冷却、负盈利按日结算），把它们塞进一套 trigger/condition/reward
-- 模型要么表达不了，要么算出来的钱与现有实现有细微差别 —— 而活动算错钱是直接资损。
-- 真实痛点也不是「造新玩法」，是「照 X 站那套来」「给我个保守型的」，模板正好解决这个。
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `pf_promo_template` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code`        VARCHAR(32)  NOT NULL,
  `name`        VARCHAR(64)  NOT NULL,
  `description` VARCHAR(255) NULL,
  `market`      VARCHAR(8)   NULL COMMENT '适用市场（PH/ID…），NULL=通用',
  -- 只存补丁：模板里没有的区块套用时保持租户原样，
  -- 所以「只调首充档位」的模板不会顺手把人家的弹窗配置冲掉
  `config`      JSON NOT NULL COMMENT 'PromoConfig 的部分区块',
  `sections`    VARCHAR(255) NOT NULL COMMENT '该模板覆盖哪些区块，逗号分隔，列表页直接显示',
  `source_tenant_id` INT UNSIGNED NULL COMMENT '从哪个租户导出的',
  `enabled`     TINYINT(1)   NOT NULL DEFAULT 1,
  `created_by`  INT UNSIGNED NULL,
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_promo_template_code` (`code`),
  CONSTRAINT `fk_promo_template_tenant` FOREIGN KEY (`source_tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='活动参数模板（P3-3）';

-- 套用记录：客户回头问「我的活动是谁什么时候改的」要答得出，
-- 也用来判断某个模板到底有没有人用
CREATE TABLE IF NOT EXISTS `pf_promo_template_apply` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `template_id` INT UNSIGNED NOT NULL,
  `tenant_id`   INT UNSIGNED NOT NULL,
  `applied_by`  VARCHAR(64) NULL COMMENT '平台管理员用户名或租户后台账号',
  `by_side`     ENUM('platform','tenant') NOT NULL DEFAULT 'platform',
  `snapshot_before` JSON NULL COMMENT '套用前的配置，出问题要能回滚',
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_apply_tenant` (`tenant_id`, `created_at`),
  CONSTRAINT `fk_apply_template` FOREIGN KEY (`template_id`) REFERENCES `pf_promo_template` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_apply_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='活动模板套用记录';
