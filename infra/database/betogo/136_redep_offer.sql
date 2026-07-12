-- 136: 复充限时优惠触发窗口
--
-- 玩法：已首充且当日未充值的用户进站时触发一个限时优惠窗口（弹窗+充值面板角标），
-- 窗口内充值 ≥ 指定档位额外送固定奖励，每个窗口只能享受一次，触发频率受冷却天数限制。
-- 档位/奖励/时长/冷却在 bg_promo_config(promo_id='redep') 配置，窗口行快照当时参数。

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `bg_redep_offer` (
  `id`               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`          VARCHAR(32)    NOT NULL,
  `min_deposit`      DECIMAL(18,2)  NOT NULL COMMENT '达标充值额（PHP，窗口创建时快照）',
  `bonus_amount`     DECIMAL(18,2)  NOT NULL COMMENT '奖励金额（PHP，窗口创建时快照）',
  `starts_at`        DATETIME(3)    NOT NULL,
  `ends_at`          DATETIME(3)    NOT NULL,
  `claimed_at`       DATETIME(3)    NULL     COMMENT '达标发放时间，NULL=未使用',
  `claimed_order_id` VARCHAR(64)    NULL     COMMENT '触发发放的充值订单',
  `created_at`       DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_user_ends` (`user_id`, `ends_at`),
  KEY `idx_user_starts` (`user_id`, `starts_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='复充限时优惠触发窗口（每窗口一次，参数快照）';
