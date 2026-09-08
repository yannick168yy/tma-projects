-- 只新增空表；不导入目录、不建立映射、不启用路由、不改写原运营配置。
CREATE TABLE bg_game_provider (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  name VARCHAR(128) NOT NULL,
  aliases JSON NOT NULL COMMENT '各聚合商厂商原始名称，人工确认',
  PRIMARY KEY (id),
  UNIQUE KEY uk_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bg_game_catalog (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider_id INT UNSIGNED NOT NULL,
  uuid VARCHAR(191) COLLATE utf8mb4_bin NOT NULL COMMENT '首次选择的展示来源ID，创建后保持稳定',
  name VARCHAR(255) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0 COMMENT '人工启用后才接管目录和旧入口',
  is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '统一游戏运营上架状态',
  presentation JSON NOT NULL COMMENT '统一展示覆盖；未设置字段继承展示来源',
  PRIMARY KEY (id),
  UNIQUE KEY uk_uuid (uuid),
  CONSTRAINT fk_catalog_provider FOREIGN KEY (provider_id) REFERENCES bg_game_provider(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bg_game_source (
  game_id INT UNSIGNED NOT NULL,
  aggregator_id VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  source_uuid VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
  currencies JSON NOT NULL COMMENT '人工确认可使用的币种；不做汇率换算或跨币种路由',
  PRIMARY KEY (game_id, aggregator_id),
  UNIQUE KEY uk_source_uuid (source_uuid),
  CONSTRAINT fk_source_game FOREIGN KEY (game_id) REFERENCES bg_game_catalog(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE bg_game_route_rule (
  scope ENUM('global','provider','game') NOT NULL,
  target_id INT UNSIGNED NOT NULL COMMENT '全局规则固定为0',
  aggregator_id VARCHAR(32) COLLATE utf8mb4_bin NOT NULL,
  PRIMARY KEY (scope, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
