-- 旧规则 currency=''，继续作为该层级的全币种兜底；新规则可按 PHP / IDR / USDT 独立切换。
ALTER TABLE bg_game_route_rule
  DROP PRIMARY KEY,
  ADD COLUMN currency VARCHAR(16) COLLATE utf8mb4_bin NOT NULL DEFAULT '' COMMENT '空=全币种兜底；PHP/IDR/USDT=指定币种' AFTER target_id,
  ADD PRIMARY KEY (scope, target_id, currency);
