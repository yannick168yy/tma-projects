-- P1-11 文案覆盖包：租户可覆盖任意 i18n key，服务端下发 patch，客户端 merge

CREATE TABLE IF NOT EXISTS `pf_tenant_i18n` (
  `tenant_id`  INT UNSIGNED NOT NULL,
  `locale`     VARCHAR(8)   NOT NULL COMMENT 'en | id | vi | zh-CN',
  -- 点号扁平键（如 checkin.title），与 infra/i18n/keys.en.json 同一套口径。
  -- 存扁平键而不是嵌套 JSON：编辑器要按 key 搜索、按条增删，嵌套结构做不到。
  `key_path`   VARCHAR(191) NOT NULL,
  `value`      TEXT         NOT NULL,
  `updated_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`tenant_id`, `locale`, `key_path`),
  CONSTRAINT `fk_tenant_i18n_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `pf_tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户文案覆盖';
