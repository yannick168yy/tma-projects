-- WXGame 聚合商接入（第二家）：无缝钱包 + 玩家级点控 RTP。
--
-- 不复用 bg_568win_* 三张表 —— 原始流水的字段形状本来就跟着上游走，两家的
-- 幂等键、作废语义、局关联方式都不同，塞进同一张表只会让两边都别扭。
-- 共用的是 bg_aggregator_player / bg_bet_order / bg_bet_round，那三张表已经
-- 带 aggregator_id，无需改动。方案见 docs/architecture/07-wxgame-integration.md。

-- 游戏目录缓存。字段只有上游 get_game_list 返回的 5 个，其余靠官方表格与我方抓取补。
CREATE TABLE IF NOT EXISTS `bg_wxgame_game` (
  -- game_id 用 utf8mb4_bin：上游 gameId 是不透明标识，实测含 : & ' . ® 等字符
  -- （如 TombstoneSlaughter:ElGordo'sRevenge）。默认的 _unicode_ci 大小写不敏感，
  -- 将来出现 Foo / foo 两款会静默合并成一行，用 _bin 精确匹配挡住。
  `game_brand`   VARCHAR(32)  COLLATE utf8mb4_bin NOT NULL COMMENT '厂商，统一小写',
  `game_id`      VARCHAR(128) COLLATE utf8mb4_bin NOT NULL COMMENT '上游 gameId，非纯数字',
  `name_en`      VARCHAR(255) NULL COMMENT 'gameName',
  `name_full`    VARCHAR(255) NULL COMMENT 'gameFullName',
  `game_type`    VARCHAR(32)  NULL COMMENT 'slot / table / fish / poker',
  `icon_url`     VARCHAR(512) NULL COMMENT '上游原始图，约三分之一是第三方直链且已失效',
  `icon_local`   VARCHAR(512) NULL COMMENT '落到我方 OSS 后的地址，前台只读这一列',
  `supports_rtp` TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '该厂商是否支持点控（仅约 34% 支持）',
  `is_maintain`  TINYINT(1)   NOT NULL DEFAULT 0,
  `is_enabled`   TINYINT(1)   NOT NULL DEFAULT 0,
  `raw_game`     JSON         NULL,
  `synced_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  -- 复合主键：不同厂商的 gameId 会重复（TADA 与 JILI 都从 2 开始），单用 game_id 会互相覆盖
  PRIMARY KEY (`game_brand`, `game_id`),
  KEY `idx_enabled_type` (`is_enabled`, `game_type`),
  KEY `idx_brand` (`game_brand`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='WXGame 游戏目录缓存';

-- 上游钱包回调的原始流水。transaction_id 上游保证全局唯一，直接作为幂等键。
CREATE TABLE IF NOT EXISTS `bg_wxgame_wallet_txn` (
  `id`                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`             VARCHAR(32)  NOT NULL COMMENT '本地用户ID',
  `player_id`           VARCHAR(64)  NOT NULL COMMENT '上游 playerId，只含数字字母',
  `currency`            VARCHAR(16)  NOT NULL,
  `transaction_id`      VARCHAR(128) COLLATE utf8mb4_bin NOT NULL COMMENT '上游交易唯一编号，幂等键',
  `round_id`            VARCHAR(128) COLLATE utf8mb4_bin NOT NULL COMMENT '局id',
  `pre_round_id`        VARCHAR(128) COLLATE utf8mb4_bin NULL COMMENT '上局id',
  -- 上游标注捕鱼等类型不传该字段，此时 refund 只能靠 round_id 定位原单（待对方确认规则）
  `bet_transaction_id`  VARCHAR(128) COLLATE utf8mb4_bin NULL COMMENT '被追溯的下注交易id，可空',
  `game_brand`          VARCHAR(32)  COLLATE utf8mb4_bin NOT NULL,
  `game_id`             VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  `txn_type`            ENUM('bet','win','refund') NOT NULL,
  `amount`              DECIMAL(18,4) NOT NULL DEFAULT 0,
  `raw_request`         JSON         NULL,
  `created_at`          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_transaction` (`transaction_id`),
  KEY `idx_user_created` (`user_id`, `created_at`),
  KEY `idx_round` (`round_id`),
  KEY `idx_bet_txn` (`bet_transaction_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='WXGame 钱包回调原始流水';

-- 玩家点控 RTP。资损敏感操作，必须留操作人与原因，后台改档要能追溯到人。
CREATE TABLE IF NOT EXISTS `bg_wxgame_player_rtp` (
  `user_id`     VARCHAR(32) NOT NULL,
  `rtp`         VARCHAR(8)  NOT NULL COMMENT '档位 50/65/75/85/90/95/97/100/150/500',
  `operator_id` VARCHAR(32) NULL COMMENT '操作的管理员',
  `reason`      VARCHAR(255) NULL,
  -- 上游 set_player_rtp 只返回设置成功的 playerIds，失败的要能看出来：
  -- 本列为 NULL 表示尚未被上游确认，需要重试或告警
  `synced_at`   DATETIME(3) NULL COMMENT '上游确认生效的时间',
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  KEY `idx_unsynced` (`synced_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='WXGame 玩家点控RTP';
