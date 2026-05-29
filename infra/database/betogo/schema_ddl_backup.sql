Emulate Docker CLI using podman. Create /etc/containers/nodocker to quiet msg.
-- MySQL dump 10.13  Distrib 8.0.46, for Linux (x86_64)
--
-- Host: localhost    Database: betogo
-- ------------------------------------------------------
-- Server version	8.0.46

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `admin_accounts`
--

DROP TABLE IF EXISTS `admin_accounts`;
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

--
-- Table structure for table `admin_audit_log`
--

DROP TABLE IF EXISTS `admin_audit_log`;
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
) ENGINE=InnoDB AUTO_INCREMENT=23 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员操作审计日志';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `bg_admin_settings`
--

DROP TABLE IF EXISTS `bg_admin_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_admin_settings` (
  `key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '配置键，如 op_password',
  `value` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '配置值（可为 JSON 字符串）',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统全局配置项';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `bg_bet_order`
--

DROP TABLE IF EXISTS `bg_bet_order`;
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
  `currency_code` char(3) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '原始投注币种',
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
) ENGINE=InnoDB AUTO_INCREMENT=39 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='竞彩/游戏账变关联单';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `bg_exchange_rate`
--

DROP TABLE IF EXISTS `bg_exchange_rate`;
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
) ENGINE=InnoDB AUTO_INCREMENT=541 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='第三方汇率快照，每小时刷新一次';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `bg_fix_faq_encoding`
--

DROP TABLE IF EXISTS `bg_fix_faq_encoding`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_fix_faq_encoding` (
  `applied_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `bg_game_session`
--

DROP TABLE IF EXISTS `bg_game_session`;
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

--
-- Table structure for table `bg_idempotency`
--

DROP TABLE IF EXISTS `bg_idempotency`;
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

--
-- Table structure for table `bg_kyc_submission`
--

DROP TABLE IF EXISTS `bg_kyc_submission`;
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

--
-- Table structure for table `bg_login_log`
--

DROP TABLE IF EXISTS `bg_login_log`;
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
) ENGINE=InnoDB AUTO_INCREMENT=77 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户登录历史';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `bg_order_deposit`
--

DROP TABLE IF EXISTS `bg_order_deposit`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_order_deposit` (
  `order_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '存款订单号',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联 bg_user.id',
  `amount` decimal(18,8) NOT NULL COMMENT 'PHP 或原始金额',
  `currency` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '支付币种',
  `credited` decimal(18,4) DEFAULT NULL COMMENT '实际入账 PHP 元',
  `channel_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'tg_wallet' COMMENT '支付渠道标识',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT 'pending | paid | failed | cancelled',
  `provider` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '支付服务商，如 yfpay',
  `provider_ref` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'ç¬¬ä¸‰æ–¹å¹³å°è®¢å•å·',
  `extra_data` json DEFAULT NULL COMMENT '渠道专有数据',
  `paid_at` datetime(3) DEFAULT NULL COMMENT '支付成功时间',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '下单时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`order_id`),
  KEY `idx_user_status` (`user_id`,`status`),
  KEY `idx_provider` (`provider`),
  KEY `idx_created` (`created_at`),
  CONSTRAINT `fk_order_deposit_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='存款订单（统一）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `bg_order_withdraw`
--

DROP TABLE IF EXISTS `bg_order_withdraw`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_order_withdraw` (
  `order_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '提款订单号',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联 bg_user.id',
  `amount` decimal(18,4) NOT NULL COMMENT '提款金额（PHP 元）',
  `currency` char(3) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '币种',
  `channel_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'tg_wallet' COMMENT '提款渠道标识',
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT 'pending | processing | completed | rejected | failed',
  `provider` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '出款服务商',
  `provider_ref` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '服务商单号',
  `extra_data` json DEFAULT NULL COMMENT '渠道专有数据',
  `reject_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '拒绝原因',
  `completed_at` datetime(3) DEFAULT NULL COMMENT '完成时间',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '申请时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`order_id`),
  KEY `idx_user_status` (`user_id`,`status`),
  KEY `idx_provider` (`provider`),
  KEY `idx_created` (`created_at`),
  CONSTRAINT `fk_order_withdraw_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='提款订单（统一）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `bg_payment_order`
--

DROP TABLE IF EXISTS `bg_payment_order`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_payment_order` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联 bg_user.id',
  `provider` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '支付服务商，如 yfpay',
  `type` enum('deposit','withdrawal') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '交易类型',
  `merchant_serial` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '商户流水号（即 order_id）',
  `platform_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '第三方平台订单号',
  `amount` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '金额（PHP 元）',
  `channel_code` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '支付渠道代码',
  `option_code` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '出款渠道选项代码',
  `target_account` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '收款账号',
  `target_owner` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '收款账号持有人',
  `state` tinyint NOT NULL DEFAULT '0' COMMENT '状态: 0=pending 1=success 2=failed 3=rejected',
  `pay_url` text COLLATE utf8mb4_unicode_ci COMMENT '支付跳转 URL',
  `extra_params` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '扩展参数 JSON',
  `notify_at` datetime DEFAULT NULL COMMENT '回调通知时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_merchant_serial` (`merchant_serial`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_state` (`state`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='YFPay 支付订单（历史数据，已迁移至 bg_order_deposit/withdraw）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `bg_promo_claim`
--

DROP TABLE IF EXISTS `bg_promo_claim`;
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

--
-- Table structure for table `bg_referral_record`
--

DROP TABLE IF EXISTS `bg_referral_record`;
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

--
-- Table structure for table `bg_session`
--

DROP TABLE IF EXISTS `bg_session`;
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

--
-- Table structure for table `bg_user`
--

DROP TABLE IF EXISTS `bg_user`;
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

--
-- Table structure for table `bg_user_profile`
--

DROP TABLE IF EXISTS `bg_user_profile`;
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

--
-- Table structure for table `bg_user_promo_state`
--

DROP TABLE IF EXISTS `bg_user_promo_state`;
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

--
-- Table structure for table `bg_wallet`
--

DROP TABLE IF EXISTS `bg_wallet`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_wallet` (
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联 bg_user.id',
  `available` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '可用余额（PHP 元）',
  `frozen` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '冻结金额（PHP 元）',
  `version` int unsigned NOT NULL DEFAULT '0' COMMENT '乐观锁',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '最后变动时间',
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_wallet_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='钱包余额';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `bg_wallet_ledger`
--

DROP TABLE IF EXISTS `bg_wallet_ledger`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_wallet_ledger` (
  `id` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '流水ID',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联 bg_user.id',
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

--
-- Table structure for table `cs_conversation`
--

DROP TABLE IF EXISTS `cs_conversation`;
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
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客服会话';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `cs_faq`
--

DROP TABLE IF EXISTS `cs_faq`;
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

--
-- Table structure for table `cs_message`
--

DROP TABLE IF EXISTS `cs_message`;
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
) ENGINE=InnoDB AUTO_INCREMENT=25 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客服消息';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sg_games`
--

DROP TABLE IF EXISTS `sg_games`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sg_games` (
  `uuid` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Slotegrator game_uuid',
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '游戏名称',
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

--
-- Table structure for table `sg_settlement_report`
--

DROP TABLE IF EXISTS `sg_settlement_report`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sg_settlement_report` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `report_date` date NOT NULL COMMENT 'ç»“ç®—æ—¥æœŸï¼ˆUTCï¼‰',
  `currency` char(3) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'SG ç»“ç®—å¸ç§',
  `sg_bet_amount` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT 'SG 报告总投注（原币）',
  `sg_win_amount` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT 'SG 报告总派彩（原币）',
  `sg_ggr` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT 'SG GGR = bet - win（原币）',
  `sg_round_count` int unsigned NOT NULL DEFAULT '0' COMMENT 'SG 报告局数',
  `local_bet` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '本地 bg_bet_order 投注总额（PHP 元）',
  `local_win` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '本地 bg_bet_order 派彩总额（PHP 元）',
  `discrepancy_note` text COLLATE utf8mb4_unicode_ci COMMENT '差异说明，NULL 表示核对一致',
  `raw_data` json DEFAULT NULL COMMENT 'SG 原始响应快照',
  `fetched_at` datetime(3) NOT NULL COMMENT '报告拉取时间',
  `reconciled` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否已核对（0=待核，1=已核）',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_date_currency` (`report_date`,`currency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Slotegrator 日结算报告及本地核对结果';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping routines for database 'betogo'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-05-29  2:40:00
