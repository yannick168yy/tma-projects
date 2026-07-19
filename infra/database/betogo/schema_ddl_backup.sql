/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `admin_accounts` (
  `id` int unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '登录账号',
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'scrypt:{salt}:{hash}',
  `role` enum('super_admin','finance','ops','support') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'support' COMMENT '角色权限',
  `status` enum('active','disabled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT '账号状态',
  `last_login_at` datetime(3) DEFAULT NULL COMMENT '最后登录时间',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='后台管理员账号';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `admin_audit_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `admin_id` int unsigned NOT NULL COMMENT '操作管理员 ID',
  `admin_username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作管理员账号',
  `action` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '操作类型，如 user.status_change',
  `target_type` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作对象类型，如 user | order',
  `target_id` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作对象 ID',
  `detail` json DEFAULT NULL COMMENT '操作详情快照',
  `ip` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作来源 IP',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '操作时间',
  PRIMARY KEY (`id`),
  KEY `idx_admin_created` (`admin_id`,`created_at` DESC),
  KEY `idx_target` (`target_type`,`target_id`),
  KEY `idx_created` (`created_at` DESC)
) ENGINE=InnoDB AUTO_INCREMENT=44 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员操作审计日志';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_admin_settings` (
  `key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '配置键，如 op_password',
  `value` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '配置值（可为 JSON 字符串）',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统全局配置项';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_bet_order` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联 bg_user.id',
  `aggregator_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '聚合商标识，如 slotegrator',
  `provider_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '游戏 UUID / 供应商游戏 ID',
  `provider_txn_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '聚合商幂等键',
  `round_id` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '游戏局号',
  `bet_type` enum('bet','win','refund','cancel') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '账变类型',
  `amount` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '换算后 PHP 金额（元）',
  `currency_code` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP',
  `original_amount` decimal(18,4) DEFAULT NULL COMMENT '原始投注金额（原币）',
  `exchange_rate` decimal(18,8) DEFAULT NULL COMMENT '入账时汇率（原币→PHP）',
  `status` enum('pending','settled','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '结算状态',
  `trace_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '请求链路 ID',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '投注时间',
  `settled_at` datetime(3) DEFAULT NULL COMMENT '结算时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_provider_txn` (`aggregator_id`,`provider_txn_id`),
  KEY `idx_user_created` (`user_id`,`created_at` DESC),
  CONSTRAINT `fk_bet_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=80 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='竞彩/游戏账变关联单';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_deposit_order` (
  `order_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `channel` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(18,6) NOT NULL,
  `status` enum('pending','paid','failed','rejected','admin_rejected') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `credited` tinyint(1) NOT NULL DEFAULT '0',
  `tx_hash` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `from_address` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_address` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `chain` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `extra` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`order_id`),
  KEY `idx_user_created` (`user_id`,`created_at`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_exchange_rate` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `currency_from` char(5) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '来源币种，如 EUR/USDT',
  `currency_to` char(5) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '目标币种，如 PHP',
  `rate` decimal(18,8) NOT NULL COMMENT '1 currency_from = rate currency_to',
  `source` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'exchangerate-api' COMMENT '汇率来源，如 exchangerate-api | coingecko',
  `fetched_at` datetime(3) NOT NULL COMMENT '抓取时间',
  PRIMARY KEY (`id`),
  KEY `idx_pair_fetched` (`currency_from`,`currency_to`,`fetched_at` DESC)
) ENGINE=InnoDB AUTO_INCREMENT=6056 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='第三方汇率快照，每小时刷新一次';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_fix_faq_encoding` (
  `applied_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_game_session` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联 bg_user.id',
  `game_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '游戏 UUID',
  `provider_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '供应商标识',
  `status` enum('active','closed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT '会话状态',
  `device_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '设备标识',
  `started_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '开始时间',
  `ended_at` datetime(3) DEFAULT NULL COMMENT '结束时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_active` (`user_id`,`status`),
  CONSTRAINT `fk_gs_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='单活跃游戏会话';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_game_turnover_rates` (
  `sort_category` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rate` decimal(5,4) NOT NULL DEFAULT '1.0000' COMMENT 'è´¡çŒ®çŽ‡ 0-1',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`sort_category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='æ¸¸æˆå¤§ç±»æµæ°´è´¡çŒ®çŽ‡';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_idempotency` (
  `idempotency_key` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '幂等键（transaction_id 等）',
  `scope` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'callback|deposit|withdraw',
  `response_snapshot` json DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '首次处理时间',
  `expires_at` datetime(3) NOT NULL COMMENT '幂等记录过期时间',
  PRIMARY KEY (`idempotency_key`),
  KEY `idx_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='HTTP 幂等';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_kyc_submission` (
  `submission_id` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'KYC 提交单号',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联 bg_user.id',
  `status` enum('none','pending','approved','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '审核状态',
  `full_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '证件全名',
  `gender` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '性别',
  `dob` date DEFAULT NULL COMMENT '出生日期',
  `doc_type` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '证件类型，如 passport | driver_license',
  `file_ids` json DEFAULT NULL COMMENT '上传文件 ID 列表',
  `reject_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '拒绝原因',
  `submitted_at` datetime(3) NOT NULL COMMENT '提交时间',
  `reviewed_at` datetime(3) DEFAULT NULL COMMENT '审核时间',
  PRIMARY KEY (`submission_id`),
  KEY `idx_user` (`user_id`),
  CONSTRAINT `fk_kyc_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='KYC 提交';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_login_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联 bg_user.id',
  `ip` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '登录 IP',
  `user_agent` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '浏览器 UA',
  `auth_method` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'telegram' COMMENT '登录方式: telegram | google',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '登录时间',
  `region` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '登录地区（国家/城市）',
  PRIMARY KEY (`id`),
  KEY `idx_user_created` (`user_id`,`created_at` DESC)
) ENGINE=InnoDB AUTO_INCREMENT=284 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户登录历史';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_matrix_deposit_address` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` varchar(64) NOT NULL COMMENT 'å•†æˆ·ç”¨æˆ· ID',
  `symbol` varchar(20) NOT NULL COMMENT 'å¸ç§ï¼Œå¦‚ USDT',
  `chain` varchar(20) NOT NULL COMMENT 'é“¾ï¼Œå¦‚ TRON',
  `address` varchar(128) NOT NULL COMMENT 'Matrix åˆ†é…çš„é“¾ä¸Šåœ°å€',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_symbol_chain` (`user_id`,`symbol`,`chain`),
  KEY `idx_address` (`address`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Matrix å……å€¼åœ°å€ç¼“å­˜';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_order_deposit` (
  `order_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(18,8) NOT NULL COMMENT 'PHP æˆ–åŽŸå§‹é‡‘é¢',
  `currency` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP',
  `credited_cents` bigint DEFAULT NULL COMMENT 'å®žé™…å…¥è´¦ PHP åˆ†',
  `channel_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'tg_wallet',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `provider` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `provider_ref` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'ç¬¬ä¸‰æ–¹å¹³å°è®¢å•å·',
  `extra_data` json DEFAULT NULL COMMENT 'æ¸ é“ä¸“æœ‰æ•°æ®',
  `paid_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`order_id`),
  KEY `idx_user_status` (`user_id`,`status`),
  KEY `idx_provider` (`provider`),
  KEY `idx_created` (`created_at`),
  CONSTRAINT `fk_order_deposit_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='å­˜æ¬¾è®¢å•ï¼ˆç»Ÿä¸€ï¼‰';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_payment_order` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `provider` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'yfpay',
  `type` enum('deposit','withdrawal') COLLATE utf8mb4_unicode_ci NOT NULL,
  `merchant_serial` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `platform_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `amount_cents` bigint NOT NULL,
  `channel_code` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `option_code` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `target_account` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `target_owner` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `state` tinyint NOT NULL DEFAULT '0',
  `pay_url` text COLLATE utf8mb4_unicode_ci,
  `extra_params` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `notify_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_merchant_serial` (`merchant_serial`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_state` (`state`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_promo_claim` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联 bg_user.id',
  `promo_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'trial|referral|firstdep',
  `amount` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '奖励金额（PHP 元）',
  `claimed_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '领取时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_promo` (`user_id`,`promo_id`),
  CONSTRAINT `fk_claim_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='活动领取记录';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_promo_config` (
  `promo_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `config_key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `config_value` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`promo_id`,`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='促销活动可配置参数';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_referral_record` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `inviter_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '邀请人 bg_user.id',
  `invitee_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '被邀请人 bg_user.id',
  `role` enum('inviter','invitee') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '本行角色',
  `status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT 'pending | qualified | rewarded',
  `reward` decimal(18,4) DEFAULT NULL COMMENT '奖励金额（PHP 元）',
  `qualified_at` datetime(3) DEFAULT NULL COMMENT '被邀请人首充达标时间',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_invitee` (`invitee_id`),
  KEY `idx_inviter` (`inviter_id`),
  CONSTRAINT `fk_ref_invitee` FOREIGN KEY (`invitee_id`) REFERENCES `bg_user` (`id`),
  CONSTRAINT `fk_ref_inviter` FOREIGN KEY (`inviter_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='邀请关系与奖励';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_session` (
  `token` char(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '会话令牌（随机 hex）',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联 bg_user.id',
  `expires_at` datetime(3) NOT NULL COMMENT '过期时间',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  PRIMARY KEY (`token`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_expires_at` (`expires_at`),
  CONSTRAINT `fk_session_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='登录会话';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_team_commission` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `beneficiary_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '佣金收益人（推荐人）',
  `from_user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'GGR 产生人（下线玩家）',
  `level` tinyint NOT NULL COMMENT '关系层级：1/2/3',
  `period` char(7) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '佣金所属月份，如 2026-06',
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP',
  `ggr_cents` bigint NOT NULL DEFAULT '0' COMMENT '下线有效 GGR（已归零处理）',
  `rate_pct` decimal(5,2) NOT NULL COMMENT '佣金费率（%），如 25.00',
  `commission_cents` bigint NOT NULL DEFAULT '0' COMMENT '佣金金额 = ggr × rate / 100',
  `status` enum('pending','paid','voided') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `paid_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `fx_rate` decimal(12,6) NOT NULL DEFAULT '1.000000',
  `php_equivalent_cents` bigint NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_commission_full` (`beneficiary_id`,`from_user_id`,`period`,`currency`,`level`),
  KEY `idx_beneficiary_period` (`beneficiary_id`,`period`),
  KEY `idx_period_status` (`period`,`status`),
  KEY `idx_from_user` (`from_user_id`),
  KEY `idx_beneficiary_period_status` (`beneficiary_id`,`period`,`status`),
  CONSTRAINT `fk_tc_beneficiary` FOREIGN KEY (`beneficiary_id`) REFERENCES `bg_user` (`id`),
  CONSTRAINT `fk_tc_from` FOREIGN KEY (`from_user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=75 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='月度佣金分配明细，一条 GGR 快照最多生成 L1/L2/L3 三条记录';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_team_config` (
  `id` int NOT NULL DEFAULT '1' COMMENT '单行配置，固定 id=1',
  `l1_rate_pct` decimal(5,2) NOT NULL DEFAULT '25.00' COMMENT 'L1 佣金率（%）',
  `l2_rate_pct` decimal(5,2) NOT NULL DEFAULT '8.00' COMMENT 'L2 佣金率（%）',
  `l3_rate_pct` decimal(5,2) NOT NULL DEFAULT '3.00' COMMENT 'L3 佣金率（%）',
  `min_activation_cents` bigint NOT NULL DEFAULT '10000' COMMENT '激活门槛（分），默认 ₱100',
  `min_withdrawal_cents` bigint NOT NULL DEFAULT '5000' COMMENT '最低提现额（分），默认 ₱50',
  `max_commission_per_settlement_cents` bigint DEFAULT NULL COMMENT '单次结算单用户佣金上限，NULL=不限',
  `settlement_day` tinyint NOT NULL DEFAULT '1' COMMENT '每月自动结算日（1-28），0=纯手动',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `updated_by` int DEFAULT NULL COMMENT '最后修改的 admin_id',
  `settlement_hour` tinyint NOT NULL DEFAULT '3',
  `last_auto_settlement` varchar(7) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `chk_l1_rate` CHECK ((`l1_rate_pct` between 0 and 100)),
  CONSTRAINT `chk_l2_rate` CHECK ((`l2_rate_pct` between 0 and 100)),
  CONSTRAINT `chk_l3_rate` CHECK ((`l3_rate_pct` between 0 and 100)),
  CONSTRAINT `chk_settlement_day` CHECK ((`settlement_day` between 0 and 28))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='三级分销佣金费率与结算配置（单行）';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_team_ggr_monthly` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `period` char(7) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '结算月份，如 2026-06',
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP',
  `bet_cents` bigint NOT NULL DEFAULT '0' COMMENT '当月总投注（分）',
  `win_cents` bigint NOT NULL DEFAULT '0' COMMENT '当月总派彩（分）',
  `ggr_cents` bigint NOT NULL DEFAULT '0' COMMENT 'GGR = bet - win，可为负',
  `effective_ggr_cents` bigint NOT NULL DEFAULT '0' COMMENT '有效 GGR = MAX(ggr,0)，负月归零',
  `negative_ggr` tinyint(1) NOT NULL DEFAULT '0' COMMENT '当月 GGR 为负（玩家赢钱月）',
  `settled` tinyint(1) NOT NULL DEFAULT '0' COMMENT '佣金是否已分配完毕',
  `settled_at` datetime(3) DEFAULT NULL,
  `calculated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_ggr_user_period_currency` (`user_id`,`period`,`currency`),
  KEY `idx_period_settled` (`period`,`settled`),
  CONSTRAINT `fk_tgm_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=33 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户月度 GGR 快照，负 GGR 月份有效值归零，不向上线分佣';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_team_node` (
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '当前用户',
  `l1_referrer_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '一级推荐人（直邀）',
  `l2_referrer_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '二级推荐人',
  `l3_referrer_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '三级推荐人',
  `activated` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否已激活（首充达标）',
  `activation_cents` bigint DEFAULT NULL COMMENT '激活时的首充金额（分）',
  `activated_at` datetime(3) DEFAULT NULL COMMENT '激活时间',
  `opted_in` tinyint(1) NOT NULL DEFAULT '0' COMMENT '用户已主动开启代理',
  `opted_in_at` datetime(3) DEFAULT NULL COMMENT '开启代理时间',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  KEY `idx_l1` (`l1_referrer_id`),
  KEY `idx_l2` (`l2_referrer_id`),
  KEY `idx_l3` (`l3_referrer_id`),
  KEY `idx_activated` (`activated`),
  KEY `idx_l1_activated` (`l1_referrer_id`,`activated`),
  KEY `idx_l2_activated` (`l2_referrer_id`,`activated`),
  KEY `idx_l3_activated` (`l3_referrer_id`,`activated`),
  CONSTRAINT `fk_tn_l1` FOREIGN KEY (`l1_referrer_id`) REFERENCES `bg_user` (`id`),
  CONSTRAINT `fk_tn_l2` FOREIGN KEY (`l2_referrer_id`) REFERENCES `bg_user` (`id`),
  CONSTRAINT `fk_tn_l3` FOREIGN KEY (`l3_referrer_id`) REFERENCES `bg_user` (`id`),
  CONSTRAINT `fk_tn_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户三级归属树，注册时写入，激活后上线方可获得 GGR 佣金';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_team_optin` (
  `id` tinyint NOT NULL DEFAULT '1',
  `applied_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='迁移哨兵表，无实际业务用途';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_team_wallet` (
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `available_cents` bigint NOT NULL DEFAULT '0' COMMENT '可提现余额（分）',
  `frozen_cents` bigint NOT NULL DEFAULT '0' COMMENT '提现申请冻结中（分）',
  `lifetime_earned_cents` bigint NOT NULL DEFAULT '0' COMMENT '历史累计收益（分，只增不减）',
  `version` int unsigned NOT NULL DEFAULT '0' COMMENT '乐观锁版本号',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP',
  PRIMARY KEY (`user_id`,`currency`),
  CONSTRAINT `fk_tw_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='佣金账户，独立于主钱包，提现时转入主钱包';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_team_withdrawal` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount_cents` bigint NOT NULL COMMENT '提现金额（分）',
  `status` enum('pending','approved','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `admin_id` int DEFAULT NULL COMMENT '审核管理员 bg_admin.id',
  `reject_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviewed_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_user_status` (`user_id`,`status`),
  KEY `idx_status_created` (`status`,`created_at` DESC),
  CONSTRAINT `fk_twd_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='佣金提现申请，Admin 审核后转入主钱包';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_turnover_allocations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `log_id` bigint unsigned NOT NULL,
  `requirement_id` bigint unsigned NOT NULL,
  `allocated_amount` decimal(18,4) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_log` (`log_id`),
  KEY `idx_requirement` (`requirement_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='æµæ°´è¦æ±‚åˆ†é…æ˜Žç»†';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_turnover_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP',
  `bet_order_id` bigint unsigned NOT NULL COMMENT 'å…³è” bg_bet_order.id',
  `bet_amount` decimal(18,4) NOT NULL,
  `rate` decimal(5,4) NOT NULL DEFAULT '1.0000',
  `effective_amount` decimal(18,4) NOT NULL COMMENT 'bet_amount * rateï¼Œå®žé™…è®¡å…¥çš„æµæ°´é¢',
  `sort_category` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_reversed` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bet_order` (`bet_order_id`),
  KEY `idx_user_created` (`user_id`,`created_at` DESC)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='æŠ•æ³¨æµæ°´æ˜Žç»†';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_turnover_requirements` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP',
  `source_type` enum('deposit','promotion') COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_ref` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'å­˜æ¬¾ orderId æˆ–ä¼˜æƒ ç±»åž‹(trial/referral/firstdep)',
  `required_amount` decimal(18,4) NOT NULL,
  `completed_amount` decimal(18,4) NOT NULL DEFAULT '0.0000',
  `status` enum('pending','completed','expired','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `expires_at` datetime DEFAULT NULL COMMENT 'ä»…ä¼˜æƒ ç±»è¦æ±‚æœ‰æœ‰æ•ˆæœŸï¼ŒNULL=æ°¸ä¹…',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_user_status` (`user_id`,`status`),
  KEY `idx_expires` (`expires_at`,`status`),
  KEY `idx_turnover_req_user_currency_status` (`user_id`,`currency`,`status`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='ç”¨æˆ·æµæ°´è¦æ±‚';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_user` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '平台用户ID，如 BG-10001',
  `telegram_user_id` bigint unsigned DEFAULT NULL COMMENT 'Telegram user.id',
  `telegram_username` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Telegram 用户名（@handle）',
  `google_sub` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Google OAuth sub',
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '用户邮箱',
  `display_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '昵称/展示名',
  `avatar_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '头像地址',
  `invite_code` char(8) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '邀请码，唯一',
  `inviter_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '邀请人 bg_user.id',
  `locale` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'en' COMMENT 'en|id|vi|zh-CN',
  `status` enum('active','frozen','banned') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT '账号状态',
  `label` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'normal' COMMENT '用户标签: normal | arbitrage',
  `status_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '状态变更原因',
  `registered_at` datetime(3) NOT NULL COMMENT '注册时间',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '记录创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '记录更新时间',
  `last_login_at` datetime(3) DEFAULT NULL COMMENT '最后登录时间',
  `register_ip` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '注册 IP',
  `register_region` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '注册地区',
  `last_login_ip` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最后登录 IP',
  `last_login_region` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最后登录地区',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_invite_code` (`invite_code`),
  UNIQUE KEY `uk_telegram_user_id` (`telegram_user_id`),
  UNIQUE KEY `uk_google_sub` (`google_sub`),
  KEY `idx_inviter_id` (`inviter_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户主表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_user_profile` (
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联 bg_user.id',
  `first_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '名',
  `last_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '姓',
  `gender` enum('','male','female','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '性别',
  `dob_month` char(2) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '出生月（01-12）',
  `dob_day` char(2) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '出生日（01-31）',
  `dob_year` char(4) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '出生年（如 1990）',
  `phone` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '手机号',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '记录创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '记录更新时间',
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_profile_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户资料';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_user_promo_state` (
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联 bg_user.id',
  `trial_claimed` tinyint(1) NOT NULL DEFAULT '0' COMMENT '体验金已领取',
  `referral_claimed` tinyint(1) NOT NULL DEFAULT '0' COMMENT '邀请奖励已领取',
  `first_dep_claimed` tinyint(1) NOT NULL DEFAULT '0' COMMENT '首充奖励已领取',
  `referral_ready` tinyint(1) NOT NULL DEFAULT '0' COMMENT '邀请人可领',
  `first_dep_ready` tinyint(1) NOT NULL DEFAULT '0' COMMENT '首充奖励待领取',
  `referral_milestone_met` tinyint(1) NOT NULL DEFAULT '0' COMMENT '被邀请人首充已判定',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '记录更新时间',
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_promo_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='活动/邀请状态';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_wallet` (
  `user_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `available` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `frozen` decimal(18,6) NOT NULL DEFAULT '0.000000',
  `version` int NOT NULL DEFAULT '0',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`,`currency`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_wallet_ledger` (
  `id` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '流水ID',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联 bg_user.id',
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP',
  `type` enum('deposit','withdraw','bet','win','red_packet','bonus','adjust','admin_adjust') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '账变类型',
  `amount` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '账变金额（PHP 元，正负）',
  `balance_after` bigint NOT NULL COMMENT '账变后余额（分）',
  `ref_type` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'deposit_order|withdraw_order|bet_order|promo',
  `ref_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联单号，如 order_id / round_id',
  `description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '账变描述',
  `trace_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '请求链路 ID',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_created` (`user_id`,`created_at` DESC),
  KEY `idx_ref` (`ref_type`,`ref_id`),
  KEY `idx_type` (`type`),
  CONSTRAINT `fk_ledger_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='钱包流水（只追加）';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_wallet_ledger_team_type` (
  `id` tinyint NOT NULL DEFAULT '1',
  `applied_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='è¿ç§»å“¨å…µï¼Œæ— ä¸šåŠ¡ç”¨é€”';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_withdraw_order` (
  `order_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `channel` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(18,6) NOT NULL,
  `status` enum('pending','processing','completed','failed','rejected','admin_rejected') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `to_address` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `chain` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `refunded` tinyint(1) NOT NULL DEFAULT '0',
  `reject_reason` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `extra` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`order_id`),
  KEY `idx_user_created` (`user_id`,`created_at`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cs_conversation` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联 bg_user.id',
  `status` enum('active','human_taken','resolved','closed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT '会话状态',
  `assigned_admin_id` int unsigned DEFAULT NULL COMMENT '接管的管理员 ID',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `resolved_at` datetime DEFAULT NULL COMMENT '解决时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_updated_at` (`updated_at`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客服会话';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cs_faq` (
  `id` int unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `category` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'FAQ 分类，如 deposit | withdraw | account',
  `question` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '问题',
  `answer` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '答案',
  `lang` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'zh' COMMENT '语言代码，如 zh | en',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '同分类内排序权重（越小越靠前）',
  `is_active` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否启用',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_category` (`category`,`lang`),
  KEY `idx_active` (`is_active`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客服 FAQ 知识库';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cs_message` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `conversation_id` bigint unsigned NOT NULL COMMENT '关联 cs_conversation.id',
  `role` enum('user','assistant','admin') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '消息来源: user | assistant | admin',
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '消息内容',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '发送时间',
  PRIMARY KEY (`id`),
  KEY `idx_conversation_id` (`conversation_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=57 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客服消息';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sg_games` (
  `uuid` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Slotegrator game_uuid',
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '游戏名称',
  `name_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name_vi` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name_zh` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `type` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '游戏类型，如 slots | baccarat',
  `provider` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '供应商代码，如 PRAGMATIC',
  `provider_id` int DEFAULT NULL COMMENT '供应商数字 ID',
  `technology` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '技术: HTML5 | Flash',
  `category` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '主分类，如 slots | live',
  `sub_category` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '子分类',
  `image_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '封面图地址',
  `image_hq_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '高清图地址',
  `has_demo` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否支持试玩',
  `has_lobby` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否有大厅入口',
  `has_freespins` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否支持免费旋转',
  `has_tables` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否有桌子',
  `label` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '子供应商标签',
  `rtp` decimal(5,2) DEFAULT NULL COMMENT '玩家回报率 RTP %',
  `volatility` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '波动性: low|medium|high',
  `reels_count` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '转轮数，如 5+1',
  `lines_count` int DEFAULT NULL COMMENT '赔付线数',
  `is_mobile` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否支持移动端',
  `tags` json DEFAULT NULL COMMENT '标签列表',
  `features` json DEFAULT NULL COMMENT '特性列表，如 bonus_buy',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '最后同步时间',
  `is_active` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否在平台上架',
  `weight` smallint NOT NULL DEFAULT '0' COMMENT '菲律宾市场受欢迎度 0-100',
  `ph_bonus` tinyint unsigned NOT NULL DEFAULT '0',
  `weight_breakdown` json DEFAULT NULL,
  `is_featured` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否推荐到首页',
  `sort_category` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '前端分类: slots/fishing/live/bingo/crash/table',
  `theme` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '游戏主题: fishing/asian/mythology/...',
  `game_style` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '风格: asian/western/classic/modern',
  `player_type` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '适合玩家: casual/regular/high-roller',
  `description_en` text COLLATE utf8mb4_unicode_ci COMMENT '游戏英文简介',
  `description_zh` text COLLATE utf8mb4_unicode_ci COMMENT '游戏中文简介',
  `search_keywords` text COLLATE utf8mb4_unicode_ci COMMENT '站内搜索关键词（空格分隔）',
  `weight_updated_at` datetime(3) DEFAULT NULL COMMENT '权重最后更新时间',
  PRIMARY KEY (`uuid`),
  KEY `idx_provider` (`provider`),
  KEY `idx_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Slotegrator 游戏列表缓存';
/*!40101 SET character_set_client = @saved_cs_client */;
