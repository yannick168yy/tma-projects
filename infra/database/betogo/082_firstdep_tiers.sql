-- 082: 首充嘉年华改为「按币种档位」模型
-- 每个币种一套档位（充值额 -> 首存奖励），充值成功时按该币种向下匹配最近档位发奖励。
-- enabled / turnover_x / turnover_days 仍沿用 bg_promo_config 的 firstdep（全局开关）。
-- 旧的 match_pct / max_bonus / min_deposit 不再使用，保留不删（避免清数据）。

CREATE TABLE IF NOT EXISTS `bg_firstdep_tiers` (
  `currency`       VARCHAR(16)   NOT NULL COMMENT '币种：PHP / USDT / USDC',
  `deposit_amount` DECIMAL(20,4) NOT NULL COMMENT '充值额（该币种口径）',
  `bonus_amount`   DECIMAL(20,4) NOT NULL COMMENT '首存奖励（同币种发放）',
  PRIMARY KEY (`currency`, `deposit_amount`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='首充嘉年华按币种档位配置';

INSERT INTO `bg_firstdep_tiers` (`currency`, `deposit_amount`, `bonus_amount`) VALUES
  ('PHP',   20,     5),
  ('PHP',   50,     10),
  ('PHP',   100,    15),
  ('PHP',   200,    30),
  ('PHP',   500,    60),
  ('PHP',   1000,   70),
  ('PHP',   5000,   100),
  ('PHP',   10000,  150),
  ('PHP',   50000,  1000),
  ('USDT',  1,      0.2),
  ('USDT',  5,      1),
  ('USDT',  10,     2),
  ('USDT',  50,     8),
  ('USDT',  100,    15),
  ('USDT',  500,    60),
  ('USDT',  1000,   100),
  ('USDC',  1,      0.2),
  ('USDC',  5,      1),
  ('USDC',  10,     2),
  ('USDC',  50,     8),
  ('USDC',  100,    15),
  ('USDC',  500,    60),
  ('USDC',  1000,   100)
ON DUPLICATE KEY UPDATE `bonus_amount` = VALUES(`bonus_amount`);
