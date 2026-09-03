-- BetoGo 租户库结构基线（由 scripts/dump-schema-baseline.sh 生成，勿手工编辑）
-- 仅用于新租户开站建库：只对「零张表的空库」执行；对已有库执行没有意义也不被允许。
-- 不含 DROP TABLE，即使误执行也不会清空既有数据。
SET NAMES utf8mb4;

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
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `admin_accounts` (
  `id` int unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '登录账号',
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'scrypt:{salt}:{hash}',
  `totp_secret` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Google Authenticator TOTP secret',
  `totp_enabled` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否启用 Google Authenticator',
  `totp_confirmed_at` datetime(3) DEFAULT NULL COMMENT 'TOTP 首次确认时间',
  `role` enum('super_admin','finance','ops','support') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'support' COMMENT '角色权限',
  `status` enum('active','disabled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT '账号状态',
  `last_login_at` datetime(3) DEFAULT NULL COMMENT '最后登录时间',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='后台管理员账号';
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
) ENGINE=InnoDB AUTO_INCREMENT=241 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员操作审计日志';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_568win_agent` (
  `agent_username` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '568Win Agent Username',
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Agent 币种，创建后不可变',
  `min_bet` decimal(18,4) NOT NULL COMMENT '568Win Agent 最小投注额',
  `max_bet` decimal(18,4) NOT NULL COMMENT '568Win Agent 最大投注额',
  `max_bet_per_match` decimal(18,4) NOT NULL COMMENT '568Win Agent 单场最大投注额',
  `casino_table_limit` tinyint NOT NULL COMMENT '568Win 真人桌台限额等级',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT '业务状态',
  `raw_response` json DEFAULT NULL COMMENT '原始响应 JSON',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`agent_username`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='568Win Agent 映射';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_568win_game` (
  `game_id` int NOT NULL COMMENT '568Win 游戏 ID',
  `game_provider_id` int NOT NULL COMMENT '568Win 游戏厂商 ID（GpId）',
  `provider` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '游戏厂商名称',
  `provider_short` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '厂商简称',
  `new_game_type` int DEFAULT NULL COMMENT '568Win 新游戏分类',
  `game_type` int DEFAULT NULL COMMENT '568Win 原始游戏类型',
  `site_category_auto` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '网站分类（自动推导）',
  `rank_no` int DEFAULT NULL COMMENT '568Win 排序序号',
  `device` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '支持设备，m=移动端，d=桌面端',
  `platform` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '游戏平台标识',
  `rtp` decimal(8,2) DEFAULT NULL COMMENT '理论返还率',
  `rows_count` int DEFAULT NULL COMMENT '老虎机行数',
  `reels_count` int DEFAULT NULL COMMENT '老虎机转轴数',
  `lines_count` int DEFAULT NULL COMMENT '老虎机赔付线数',
  `name_en` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '英文游戏名称',
  `name_zh` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '中文游戏名称',
  `icon_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '游戏图标地址',
  `icon_width` smallint unsigned DEFAULT NULL COMMENT '封面实际像素宽',
  `icon_height` smallint unsigned DEFAULT NULL COMMENT '封面实际像素高',
  `icon_probed_at` datetime(3) DEFAULT NULL COMMENT '宽高探测时间，NULL=待探测',
  `supported_currencies` json DEFAULT NULL COMMENT '支持币种列表，UCC 按 USDT 处理',
  `block_countries` json DEFAULT NULL COMMENT '屏蔽国家或地区列表',
  `is_enabled` tinyint(1) NOT NULL DEFAULT '0' COMMENT '568Win 游戏是否启用',
  `is_maintain` tinyint(1) NOT NULL DEFAULT '0' COMMENT '568Win 游戏是否维护中',
  `provider_status` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '568Win 厂商状态',
  `is_provider_online` tinyint(1) NOT NULL DEFAULT '0' COMMENT '568Win 厂商是否在线',
  `is_provide_commission` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否提供佣金',
  `has_hedge_bet` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否支持对冲投注',
  `raw_game` json DEFAULT NULL COMMENT '568Win 原始游戏资料',
  `raw_response` json DEFAULT NULL COMMENT '568Win 同步接口原始响应片段',
  `synced_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '最近同步时间',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`game_provider_id`,`game_id`),
  KEY `idx_enabled_type` (`is_enabled`,`new_game_type`),
  KEY `idx_provider` (`provider`),
  KEY `idx_rank` (`rank_no`),
  KEY `idx_game_id` (`game_id`),
  KEY `idx_site_category_auto` (`site_category_auto`),
  KEY `idx_provider_short` (`provider_short`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='568Win 游戏列表缓存';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_568win_game_cover_candidate` (
  `game_provider_id` int NOT NULL COMMENT '游戏供应商 ID',
  `game_id` int NOT NULL COMMENT '游戏 ID',
  `source` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'playtime/fbmplay/gzone/casinoplus',
  `url` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'é™æ€å°é¢URL',
  `anim_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'åŠ¨å›¾URL(ä»… playtime éƒ¨åˆ†æ¸¸æˆæœ‰)',
  PRIMARY KEY (`game_provider_id`,`game_id`,`source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='568Win æ¸¸æˆå¤šæºå°é¢å€™é€‰';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_568win_game_override` (
  `game_provider_id` int NOT NULL COMMENT '568Win gameProviderId/GpId',
  `game_id` int NOT NULL COMMENT '568Win gameID',
  `is_active` tinyint(1) DEFAULT NULL COMMENT '本地上下架，NULL 表示跟随上游可用状态',
  `weight` int DEFAULT NULL COMMENT '本地排序权重',
  `weight_breakdown` json DEFAULT NULL COMMENT '权重评分明细 JSON',
  `is_featured` tinyint(1) DEFAULT NULL COMMENT '本地推荐标记',
  `sort_category` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '本地前端分类覆盖',
  `site_category` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '网站分类人工覆盖，NULL 跟随自动分类',
  `weight_updated_at` datetime(3) DEFAULT NULL COMMENT '权重最后更新时间',
  `name_override` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '本地展示名覆盖',
  `image_override` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '本地图片覆盖',
  `image_override_source` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '封面覆盖来源: playtime/gzone/casinoplus/manual',
  `image_anim` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'åŠ¨å›¾å°é¢URL',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`game_provider_id`,`game_id`),
  KEY `idx_active` (`is_active`),
  KEY `idx_featured` (`is_featured`),
  KEY `idx_sort_category` (`sort_category`),
  KEY `idx_site_category` (`site_category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='568Win 游戏本地运营配置';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_568win_provider` (
  `provider` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '厂商统一显示名,与 bg_568win_game.provider 一致',
  `weight` int NOT NULL DEFAULT '1000' COMMENT '厂商权重,越大越靠前(0-10000)',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`provider`),
  KEY `idx_weight` (`weight`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='568Win 厂商运营配置';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_568win_report_bet` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `portfolio` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '568Win portfolio',
  `ref_no` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '568Win RefNo',
  `external_username` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '568Win Username',
  `currency` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '币种代码',
  `status` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '业务状态',
  `stake` decimal(18,4) DEFAULT NULL COMMENT '投注金额',
  `win_lost` decimal(18,4) DEFAULT NULL COMMENT '输赢金额',
  `order_time` datetime(3) DEFAULT NULL COMMENT '下注时间',
  `settle_time` datetime(3) DEFAULT NULL COMMENT '结算时间',
  `win_lost_date` datetime(3) DEFAULT NULL COMMENT '输赢归属日期',
  `modify_date` datetime(3) DEFAULT NULL COMMENT '上游修改时间',
  `raw_bet` json NOT NULL COMMENT '568Win 注单原始 JSON',
  `raw_response` json DEFAULT NULL COMMENT '568Win 报表响应原文',
  `fetched_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '抓取时间',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_portfolio_ref` (`portfolio`,`ref_no`),
  KEY `idx_username` (`external_username`),
  KEY `idx_order_time` (`order_time`),
  KEY `idx_modify_date` (`modify_date`),
  KEY `idx_ref_no` (`ref_no`)
) ENGINE=InnoDB AUTO_INCREMENT=403 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='568Win 报表注单原始数据';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_568win_wallet_txn` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '本地用户ID',
  `external_username` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '568Win Username',
  `currency` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '币种代码',
  `transfer_code` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '568Win TransferCode',
  `transaction_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '568Win TransactionId，无则为空串',
  `product_type` int NOT NULL COMMENT '产品类型',
  `game_type` int NOT NULL COMMENT '游戏类型',
  `gpid` int DEFAULT NULL COMMENT '游戏供应商产品 ID',
  `provider_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '供应商 ID',
  `round_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '游戏局号',
  `txn_type` enum('bet','bonus') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '交易类型',
  `amount` decimal(18,4) NOT NULL COMMENT '投注或红利金额',
  `win_loss` decimal(18,4) DEFAULT NULL COMMENT 'Settle WinLoss，已含本金',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'running|settled|Void',
  `raw_request` json DEFAULT NULL COMMENT '568Win 钱包回调原始请求',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  `settled_at` datetime(3) DEFAULT NULL COMMENT '结算时间',
  `voided_at` datetime(3) DEFAULT NULL COMMENT '作废时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_transfer_txn` (`transfer_code`,`transaction_id`),
  KEY `idx_user_created` (`user_id`,`created_at` DESC),
  KEY `idx_transfer` (`transfer_code`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`),
  KEY `idx_user_provider_round_id` (`user_id`,`provider_id`,`round_id`,`id`),
  KEY `idx_user_provider_id` (`user_id`,`provider_id`,`id`),
  CONSTRAINT `fk_568win_txn_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=485300 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='568Win Seamless Wallet 交易状态';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_ad_channel_price` (
  `channel_code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cpa_usd` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT '每有效首存单价(USD),0=未定价',
  `remark` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`channel_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='投放渠道CPA单价配置';
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
CREATE TABLE `bg_agent` (
  `agent_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '代理用户ID（= bg_user.id）',
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '代理名称/备注名',
  `ggr_rate_pct` decimal(5,2) NOT NULL DEFAULT '0.00' COMMENT 'GGR 分成比例（%）',
  `status` enum('active','disabled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT '业务状态',
  `remark` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '备注',
  `created_by` int DEFAULT NULL COMMENT '操作管理员ID',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`agent_id`),
  KEY `idx_status` (`status`),
  CONSTRAINT `fk_agent_user` FOREIGN KEY (`agent_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='代理主体，后台手动指定，享名下用户 GGR 分成';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_agent_bot` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `bot_username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'bot 用户名（不含 @）',
  `bot_id` bigint DEFAULT NULL COMMENT 'getMe 返回的 bot id',
  `bot_token` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'bot token，用于验签识别入口（不对外返回）',
  `label` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '备注名',
  `agent_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '归属代理，空=未分配',
  `enabled` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否启用',
  `created_by` int DEFAULT NULL COMMENT '创建管理员 ID',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bot_username` (`bot_username`),
  KEY `idx_agent` (`agent_id`),
  CONSTRAINT `fk_abot_agent` FOREIGN KEY (`agent_id`) REFERENCES `bg_agent` (`agent_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='代理 TMA 机器人池，存 token 供多 token 验签识别入口';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_agent_commission` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `agent_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联渠道代理 ID',
  `period` char(7) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分成月份，如 2026-06',
  `ggr_cents` bigint NOT NULL DEFAULT '0' COMMENT '当月 GGR（可为负）',
  `carry_in_cents` bigint NOT NULL DEFAULT '0' COMMENT '上期结转（<=0）',
  `net_ggr_cents` bigint NOT NULL DEFAULT '0' COMMENT 'ggr + carry_in',
  `carry_out_cents` bigint NOT NULL DEFAULT '0' COMMENT '结转下期（<=0）',
  `rate_pct` decimal(5,2) NOT NULL DEFAULT '0.00' COMMENT '费率百分比',
  `commission_cents` bigint NOT NULL DEFAULT '0' COMMENT '应分金额 = MAX(net,0) * rate / 100',
  `status` enum('pending','paid','voided') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT 'pending=待打款 paid=已线下打款 voided=作废',
  `paid_at` datetime(3) DEFAULT NULL COMMENT '支付时间',
  `settled_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '结算时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agent_period` (`agent_id`,`period`),
  KEY `idx_period_status` (`period`,`status`),
  CONSTRAINT `fk_acom_agent` FOREIGN KEY (`agent_id`) REFERENCES `bg_agent` (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='代理月度分成，负 GGR 结转下期';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_agent_domain` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `domain` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '域名（小写、去协议去端口）',
  `label` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '备注名',
  `agent_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '归属代理，空=未分配',
  `enabled` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否启用',
  `created_by` int DEFAULT NULL COMMENT '创建管理员 ID',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_domain` (`domain`),
  KEY `idx_agent` (`agent_id`),
  CONSTRAINT `fk_adomain_agent` FOREIGN KEY (`agent_id`) REFERENCES `bg_agent` (`agent_id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='代理域名池，可分配给代理';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_agent_ggr_monthly` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `agent_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联渠道代理 ID',
  `period` char(7) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '结算月份，如 2026-06',
  `bet_cents` bigint NOT NULL DEFAULT '0' COMMENT '投注金额（分）',
  `win_cents` bigint NOT NULL DEFAULT '0' COMMENT '派彩金额（分）',
  `bonus_cents` bigint NOT NULL DEFAULT '0' COMMENT '赠金+红利（扣减项）',
  `ggr_cents` bigint NOT NULL DEFAULT '0' COMMENT 'GGR = bet - win - bonus，可为负',
  `user_count` int NOT NULL DEFAULT '0' COMMENT '当月有流水的名下用户数',
  `calculated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '计算时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agent_period` (`agent_id`,`period`),
  KEY `idx_period` (`period`),
  CONSTRAINT `fk_aggm_agent` FOREIGN KEY (`agent_id`) REFERENCES `bg_agent` (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='代理月度 GGR 快照';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_aggregator_player` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `aggregator_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '聚合商标识',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '本地用户ID',
  `external_username` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '聚合商玩家账号',
  `agent_username` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '568Win Agent Username',
  `currency` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '币种代码',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT '业务状态',
  `raw_response` json DEFAULT NULL COMMENT '原始响应 JSON',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_aggregator_username` (`aggregator_id`,`external_username`),
  UNIQUE KEY `uk_aggregator_user_ccy` (`aggregator_id`,`user_id`,`currency`),
  KEY `idx_user` (`user_id`),
  CONSTRAINT `fk_aggregator_player_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=20 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='聚合商玩家账号映射';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_announcement` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `placement` varchar(32) NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '0',
  `content_en` text NOT NULL,
  `content_zh` text NOT NULL,
  `content_id` text NOT NULL,
  `content_vi` text NOT NULL,
  `starts_at` datetime DEFAULT NULL,
  `ends_at` datetime DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_placement` (`placement`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_app_download_claim` (
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'pwa | apk',
  `user_agent` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '领取时浏览器 User-Agent',
  `ip` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '领取时 IP 地址',
  `device_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '领取时设备指纹(X-Device-Id)',
  `amount` decimal(12,2) NOT NULL COMMENT '金额',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`user_id`),
  KEY `idx_appdl_device` (`device_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='APP 下载奖励领取记录';
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
  `currency_code` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '币种代码',
  `original_amount` decimal(18,4) DEFAULT NULL COMMENT '原始投注金额（原币）',
  `exchange_rate` decimal(18,8) DEFAULT NULL COMMENT '入账时汇率（原币→PHP）',
  `status` enum('pending','settled','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '结算状态',
  `trace_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '请求链路 ID',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '投注时间',
  `settled_at` datetime(3) DEFAULT NULL COMMENT '结算时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_provider_txn` (`aggregator_id`,`provider_txn_id`),
  KEY `idx_user_created` (`user_id`,`created_at` DESC),
  KEY `idx_bet_user_round` (`user_id`,`round_id`),
  KEY `idx_created` (`created_at`),
  KEY `idx_round_created` (`round_id`,`created_at`),
  KEY `idx_provider_txn_created` (`provider_txn_id`,`created_at`),
  CONSTRAINT `fk_bet_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=990999015 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='竞彩/游戏账变关联单';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_bet_round` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `round_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '局号(568win注单 round_id 恒非空)',
  `aggregator_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '568win',
  `provider_txn_id` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '本局bet行的provider_txn_id，读时JOIN取游戏名',
  `bet_amount` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '=SUM(bet_type=bet)',
  `win_amount` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '=SUM(bet_type in win,refund)',
  `currency_code` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP',
  `first_at` datetime(3) NOT NULL COMMENT '=MIN(created_at)',
  `last_id` bigint unsigned NOT NULL COMMENT '=MAX(bg_bet_order.id)，排序键',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_round` (`user_id`,`round_id`),
  KEY `idx_user_last` (`user_id`,`last_id`),
  KEY `idx_user_first` (`user_id`,`first_at`)
) ENGINE=InnoDB AUTO_INCREMENT=612181 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='注单按局汇总(读加速，派生自bg_bet_order)';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_capi_event` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `platform` enum('facebook','tiktok') COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_name` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '去重键：注册=userId，充值=orderId；与前端像素 eventID 同值',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('sending','sent','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'sending',
  `http_code` smallint DEFAULT NULL,
  `error` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_event` (`platform`,`event_name`,`event_id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=21 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='转化回传(CAPI)发送日志，唯一键做幂等';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_capi_pixel_token` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `platform` enum('facebook','tiktok') COLLATE utf8mb4_unicode_ci NOT NULL,
  `pixel_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `channel_code` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '渠道短码,短链 /t/<code> 与归因 c 值',
  `access_token` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL,
  `test_event_code` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '测试事件码,非空时随事件上报,验证完清空',
  `promo_domain` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '该线推广域名,如 betogo666.com',
  `remark` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '线路/投手备注，便于对账',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_pixel` (`platform`,`pixel_id`),
  KEY `idx_channel_code` (`channel_code`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='CAPI 回传 token：按像素匹配，支持多投放线/多 BM';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_category_sort_game` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `category_key` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '一级分类 id，all 表示全部分类聚合',
  `game_uuid` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '游戏 uuid，如 568win:pid:gid',
  `position` int NOT NULL DEFAULT '0' COMMENT '手动排序位次(0-based)，越小越靠前',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cat_game` (`category_key`,`game_uuid`),
  KEY `idx_cat` (`category_key`,`position`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Games 页分类 All 列表手动置顶排序';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_checkin_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `checkin_date` date NOT NULL COMMENT '签到日（马尼拉 UTC+8 日期）',
  `track` enum('base','enhanced') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'base' COMMENT '当日轨道：base=仅登录，enhanced=当日有存款或有效投注',
  `streak` int unsigned NOT NULL COMMENT '连续签到天数（断签归1）',
  `cycle_day` tinyint unsigned NOT NULL COMMENT '7天小周期内第几天 1..7',
  `month_days` int unsigned NOT NULL COMMENT '当月累计签到天数（含当天）',
  `base_rule_id` bigint unsigned DEFAULT NULL COMMENT '基础轨所发转盘档 rule_id',
  `base_chances` int unsigned NOT NULL DEFAULT '0' COMMENT '基础轨发放次数',
  `enh_rule_id` bigint unsigned DEFAULT NULL COMMENT '增强轨所发转盘档 rule_id',
  `enh_chances` int unsigned NOT NULL DEFAULT '0' COMMENT '增强轨额外发放次数',
  `milestone_days` int unsigned NOT NULL DEFAULT '0' COMMENT '当日命中的大周期里程碑（0=未命中，7/15/30）',
  `milestone_chances` int unsigned NOT NULL DEFAULT '0' COMMENT '里程碑额外发放次数',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_date` (`user_id`,`checkin_date`),
  KEY `idx_user_date` (`user_id`,`checkin_date` DESC),
  KEY `idx_date` (`checkin_date`),
  CONSTRAINT `fk_checkin_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5340 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='每日签到台账';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_deposit_order` (
  `order_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '订单号',
  `user_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `channel` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '通道代码',
  `currency` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '币种代码',
  `amount` decimal(18,6) NOT NULL COMMENT '金额',
  `status` enum('pending','paid','failed','rejected','admin_rejected') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '业务状态',
  `credited` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否已入账',
  `tx_hash` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '链上交易哈希',
  `from_address` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '付款地址',
  `to_address` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '收款地址',
  `chain` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '链网络',
  `extra` json DEFAULT NULL COMMENT '扩展数据 JSON',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`order_id`),
  KEY `idx_user_created` (`user_id`,`created_at`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='存款订单';
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
) ENGINE=InnoDB AUTO_INCREMENT=61739 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='第三方汇率快照，每小时刷新一次';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_firstdep_tiers` (
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '币种：PHP / USDT / USDC / TON / TRX',
  `deposit_amount` decimal(20,4) NOT NULL COMMENT '充值额（该币种口径）',
  `bonus_amount` decimal(20,4) NOT NULL COMMENT '首存奖励（同币种发放）',
  PRIMARY KEY (`currency`,`deposit_amount`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='首充嘉年华按币种档位配置';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_game_launch` (
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '本地用户ID',
  `game_uuid` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '游戏uuid（568win:gp:id 或 slotegrator uuid）',
  `launch_count` int NOT NULL DEFAULT '1' COMMENT '启动次数',
  `last_launched_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '最后启动时间',
  PRIMARY KEY (`user_id`,`game_uuid`),
  KEY `idx_user_time` (`user_id`,`last_launched_at` DESC),
  CONSTRAINT `fk_game_launch_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户游戏启动历史';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_game_turnover_rates` (
  `sort_category` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '前端分类',
  `rate` decimal(5,4) NOT NULL DEFAULT '1.0000' COMMENT 'è´¡çŒ®çŽ‡ 0-1',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`sort_category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='游戏大类流水贡献率';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_home_content` (
  `kind` enum('banner','card','wallet_banner') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '内容类型：banner/card/wallet_banner',
  `slot` int unsigned NOT NULL COMMENT '展示槽位序号',
  `image_key` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '图片资源键',
  `action_type` enum('promo','cashback','spin','lobby','none','path','url') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'none' COMMENT '点击动作类型',
  `action_value` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '点击动作参数',
  `value_text` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '卡片数值文案',
  `label_text` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '卡片标签文案',
  `enabled` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否启用',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`kind`,`slot`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='首页运营内容配置';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_home_content_image` (
  `kind` enum('banner','card','wallet_banner') COLLATE utf8mb4_unicode_ci NOT NULL,
  `slot` int unsigned NOT NULL,
  `locale` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `image_key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`kind`,`slot`,`locale`),
  CONSTRAINT `fk_home_content_image_item` FOREIGN KEY (`kind`, `slot`) REFERENCES `bg_home_content` (`kind`, `slot`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_homepage_frozen_board` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `section_key` varchar(32) NOT NULL,
  `currency` varchar(8) NOT NULL,
  `game_uuid` varchar(64) NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_frozen` (`section_key`,`currency`,`game_uuid`),
  KEY `idx_frozen_board` (`section_key`,`currency`,`sort_order`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_homepage_section_game` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `section_key` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '板块键，与 HomepageSelection 字段名一致',
  `game_uuid` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '游戏 uuid，如 568win:pid:gid',
  `action` enum('pin','exclude') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'pin=强制置顶/纳入, exclude=从该板块剔除',
  `pin_position` int DEFAULT NULL COMMENT '钉到第几位(1-based)，NULL=前插按 sort_order',
  `currency` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '空=全币种, PHP/USDT=仅该币种',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '无 pin_position 时的相对顺序',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_section_game_cur` (`section_key`,`game_uuid`,`currency`),
  KEY `idx_section` (`section_key`,`currency`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='首页板块手动钉位/排除配置';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_homepage_section_visibility` (
  `section_key` varchar(32) NOT NULL,
  `currency` varchar(8) NOT NULL,
  `hidden` tinyint(1) NOT NULL DEFAULT '0',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`section_key`,`currency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_idempotency` (
  `idempotency_key` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '幂等键（transaction_id 等）',
  `scope` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'callback|deposit|withdraw',
  `response_snapshot` json DEFAULT NULL COMMENT '响应快照 JSON',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '首次处理时间',
  `expires_at` datetime(3) NOT NULL COMMENT '幂等记录过期时间',
  PRIMARY KEY (`idempotency_key`),
  KEY `idx_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='HTTP 幂等';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_kyc` (
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `status` enum('none','pending','approved','rejected') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'none' COMMENT '业务状态',
  `phone` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'KYC 已验证手机(E.164)，与 phone_account 分离',
  `phone_verified` tinyint(1) NOT NULL DEFAULT '0' COMMENT '手机号是否已验证',
  `doc_verified` tinyint(1) NOT NULL DEFAULT '0' COMMENT '证件是否已验证',
  `face_verified` tinyint(1) NOT NULL DEFAULT '0' COMMENT '人脸是否已验证',
  `full_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '实名姓名',
  `doc_type` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'passport|drivers_license|philid|umid',
  `verify_mode` enum('document','face') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '验证模式',
  `extracted_id_no` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Gemini 从证件提取的证件号，用于防重',
  `gemini_confidence` decimal(4,3) DEFAULT NULL COMMENT 'Gemini 识别置信度',
  `gemini_result` json DEFAULT NULL COMMENT 'Gemini 识别结果 JSON',
  `doc_image_key` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '证件图片资源键',
  `selfie_image_key` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '自拍图片资源键',
  `liveness_frames` json DEFAULT NULL COMMENT '活体帧元数据 [{action, key, capturedAt}]',
  `reject_reason` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '拒绝原因',
  `reject_step` enum('phone','document','face') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '拒绝步骤',
  `submitted_at` datetime(3) DEFAULT NULL COMMENT '提交时间',
  `doc_submitted_at` datetime(3) DEFAULT NULL COMMENT '证件提交时间',
  `face_submitted_at` datetime(3) DEFAULT NULL COMMENT '人脸提交时间',
  `reviewed_at` datetime(3) DEFAULT NULL COMMENT '审核时间',
  `reviewed_by` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '人工复核管理员用户名(自动放行时为空)',
  `badge_ignored` tinyint(1) NOT NULL DEFAULT '0' COMMENT '后台已忽略该被拒认证的气泡提醒(1=忽略); 用户重新提交时重置为0',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`user_id`),
  KEY `idx_phone_verified` (`phone`,`phone_verified`),
  KEY `idx_extracted_id_no` (`extracted_id_no`),
  CONSTRAINT `fk_bg_kyc_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='KYC 实名认证';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_kyc_doc_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `full_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '实名姓名',
  `doc_type` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '证件类型',
  `doc_image_key` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '证件图片资源键',
  `gemini_confidence` decimal(4,3) DEFAULT NULL COMMENT 'Gemini 识别置信度',
  `doc_verified` tinyint(1) NOT NULL DEFAULT '0' COMMENT '证件是否已验证',
  `reject_reason` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '拒绝原因',
  `submitted_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '提交时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_submitted` (`user_id`,`submitted_at`)
) ENGINE=InnoDB AUTO_INCREMENT=25 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='KYC 证件提交历史';
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
  `entry_source` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '登录入口域名或 tma',
  `platform` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '客户端平台 web/app/pwa/telegram',
  `device_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '前端下发的长效设备ID',
  `fp_visitor` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'FingerprintJS 指纹hash',
  `fp_signals` json DEFAULT NULL COMMENT '设备原始信号',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '登录时间',
  `region` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '登录地区（国家/城市）',
  PRIMARY KEY (`id`),
  KEY `idx_user_created` (`user_id`,`created_at` DESC),
  KEY `idx_login_log_device` (`device_id`),
  KEY `idx_login_log_fp` (`fp_visitor`),
  KEY `idx_login_log_entry_source` (`entry_source`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=3490 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户登录历史';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_matrix_deposit_address` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(64) NOT NULL COMMENT 'å•†æˆ·ç”¨æˆ· ID',
  `symbol` varchar(20) NOT NULL COMMENT 'å¸ç§ï¼Œå¦‚ USDT',
  `chain` varchar(20) NOT NULL COMMENT 'é“¾ï¼Œå¦‚ TRON',
  `address` varchar(128) NOT NULL COMMENT 'Matrix åˆ†é…çš„é“¾ä¸Šåœ°å€',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_symbol_chain` (`user_id`,`symbol`,`chain`),
  KEY `idx_address` (`address`)
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Matrix 充值地址缓存';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_payment_callback_issue` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `provider` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `issue_type` varchar(48) COLLATE utf8mb4_unicode_ci NOT NULL,
  `order_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `provider_order_id` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status_value` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `detail` json DEFAULT NULL,
  `notified` tinyint(1) NOT NULL DEFAULT '0',
  `resolved` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `resolved_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_provider_created` (`provider`,`created_at`),
  KEY `idx_unresolved` (`resolved`,`notified`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=25 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='支付回调异常与对账问题';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_pending_install` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `attr_json` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '前端 betogo_attr 快照(JSON 原文)',
  `client_ip` varchar(45) COLLATE utf8mb4_unicode_ci NOT NULL,
  `device_key` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'UA 提取的 android版本|机型，Chrome 与壳 WebView 一致',
  `user_agent` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '点击侧 UA 原文，排查配对误差用',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `matched_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_pair` (`client_ip`,`device_key`,`id`),
  KEY `idx_key_created` (`device_key`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='APK 安装归因配对暂存';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_promo_claim_whitelist` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `type` enum('device','ip','user') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'device=X-Device-Id或硬件指纹, ip=出口IP, user=用户ID',
  `value` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注，如"测试机-yannick"',
  `created_by` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_type_value` (`type`,`value`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='领奖白名单(测试机放行)';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_promo_config` (
  `promo_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '字段：promo_id',
  `config_key` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '字段：config_key',
  `config_value` text COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`promo_id`,`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='促销活动可配置参数';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_rebate_config` (
  `game_category` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '游戏大类（与 bg_turnover_logs.sort_category 对应）',
  `rate_pct` decimal(5,3) NOT NULL DEFAULT '0.800' COMMENT '洗码比例 %（1.000 = 1%）',
  `enabled` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否参与洗码',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`game_category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='洗码费率配置，后台可调整各游戏大类比例';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_rebate_featured_game` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `game_uuid` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'sg_games.uuid',
  `tier` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'elite' COMMENT 'elite（2%档）| pro（1.5%档）',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '展示排序（升序）',
  `enabled` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否启用',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_game_tier` (`game_uuid`,`tier`)
) ENGINE=InnoDB AUTO_INCREMENT=723 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='洗码精选游戏（后台配置，C端展示噱头分档）';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_rebate_level_config` (
  `level` tinyint NOT NULL COMMENT '等级 1–6',
  `game_category` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '游戏大类（与 bg_turnover_logs.sort_category 对应）',
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '币种（每币种一套费率/封顶）',
  `rate_pct` decimal(5,3) NOT NULL DEFAULT '0.800' COMMENT '洗码比例 %（1.000 = 1%）',
  `max_bonus` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '每日每大类洗码封顶额（0=不封顶）',
  `enabled` tinyint(1) NOT NULL DEFAULT '1' COMMENT '该等级该大类是否参与洗码',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`level`,`game_category`,`currency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='洗码分级费率配置（LV1–6 × 游戏大类）';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_rebate_level_threshold` (
  `level` tinyint NOT NULL COMMENT '等级 1–6',
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '币种（每币种一套阈值）',
  `min_turnover` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '达到该等级所需的累计有效流水',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`level`,`currency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='洗码等级流水阈值（后台配置；LV1 固定 0）';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_rebate_record` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `date` date NOT NULL COMMENT '投注日期（PHT）',
  `game_category` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '游戏大类',
  `currency_code` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '币种代码',
  `bet_amount` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '当日投注额',
  `rebate_amount` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '洗码返还金额',
  `rate_pct` decimal(5,3) NOT NULL COMMENT '结算时使用的费率',
  `status` enum('pending','paid') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '业务状态',
  `paid_at` datetime(3) DEFAULT NULL COMMENT '支付时间',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_date_cat_cur` (`user_id`,`date`,`game_category`,`currency_code`),
  KEY `idx_date_status` (`date`,`status`),
  KEY `idx_user_date` (`user_id`,`date`)
) ENGINE=InnoDB AUTO_INCREMENT=54 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='每日洗码结算快照，凌晨定时任务写入并自动派发';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_redep_offer` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '窗口币种（达标/发奖均按此币种）',
  `min_deposit` decimal(18,2) NOT NULL COMMENT '达标充值额（PHP，窗口创建时快照）',
  `bonus_amount` decimal(18,2) NOT NULL COMMENT '奖励金额（PHP，窗口创建时快照）',
  `tiers_snapshot` json DEFAULT NULL COMMENT '窗口创建时的完整档位快照',
  `turnover_x` decimal(8,2) DEFAULT NULL COMMENT '命中档位的赠金流水倍数快照',
  `starts_at` datetime(3) NOT NULL,
  `ends_at` datetime(3) NOT NULL,
  `claimed_at` datetime(3) DEFAULT NULL COMMENT '达标发放时间，NULL=未使用',
  `claimed_order_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '触发发放的充值订单',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_user_ends` (`user_id`,`ends_at`),
  KEY `idx_user_starts` (`user_id`,`starts_at`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='复充限时优惠触发窗口（每窗口一次，参数快照）';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_redep_tier` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `deposit_amount` decimal(24,8) NOT NULL COMMENT '单笔充值门槛',
  `bonus_amount` decimal(24,8) NOT NULL COMMENT '赠金金额',
  `turnover_x` decimal(8,2) NOT NULL COMMENT '仅赠金部分的流水倍数',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_redep_tier_currency_amount` (`currency`,`deposit_amount`),
  KEY `idx_redep_tier_currency_sort` (`currency`,`sort_order`,`deposit_amount`)
) ENGINE=InnoDB AUTO_INCREMENT=27 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='常规复充多币种档位及每档赠金流水';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_regular_redep_claim` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `order_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `deposit_amount` decimal(18,4) NOT NULL,
  `bonus_amount` decimal(18,4) NOT NULL,
  `turnover_x` decimal(8,2) NOT NULL DEFAULT '0.00',
  `turnover_days` int NOT NULL DEFAULT '0',
  `status` enum('pending','claimed','expired','cancelled','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `expires_at` datetime(3) NOT NULL,
  `claimed_at` datetime(3) DEFAULT NULL,
  `ledger_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_regular_redep_order` (`order_id`),
  KEY `idx_regular_redep_user` (`user_id`,`status`,`expires_at`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='常规复充赠金待领取资格';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_regular_redep_tier` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `deposit_amount` decimal(24,8) NOT NULL COMMENT '单笔充值门槛',
  `bonus_amount` decimal(24,8) NOT NULL COMMENT '赠金金额',
  `turnover_x` decimal(8,2) NOT NULL COMMENT '仅赠金部分的流水倍数',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_regular_redep_tier_currency_amount` (`currency`,`deposit_amount`),
  KEY `idx_regular_redep_tier_currency_sort` (`currency`,`sort_order`,`deposit_amount`)
) ENGINE=InnoDB AUTO_INCREMENT=27 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='常规复充多币种档位及每档赠金流水';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_risk_blacklist` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `type` enum('ip','device','region','user') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '类型',
  `value` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'IP/设备ID/地域/用户ID',
  `reason` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '原因',
  `created_by` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '添加人',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_type_value` (`type`,`value`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='风控黑名单';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_risk_hit_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '登录前拦截时可能为空',
  `checkpoint` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rule_code` varchar(48) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` enum('tag_only','limit','deny','escalate') COLLATE utf8mb4_unicode_ci NOT NULL,
  `matched_value` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '命中的具体值，如被封的 IP',
  `detail` json DEFAULT NULL,
  `ip` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `device_id` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_user_created` (`user_id`,`created_at`),
  KEY `idx_checkpoint_created` (`checkpoint`,`created_at`),
  KEY `idx_action` (`action`)
) ENGINE=InnoDB AUTO_INCREMENT=33 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='风控命中日志';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_risk_policy` (
  `checkpoint` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'login | promo_claim | withdraw',
  `rule_code` varchar(48) COLLATE utf8mb4_unicode_ci NOT NULL,
  `action` enum('tag_only','limit','deny','escalate') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'tag_only',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `params` json DEFAULT NULL COMMENT '规则阈值，如 {"minRatio":1.5}',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`checkpoint`,`rule_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='风控策略：管控点 × 规则 → 动作';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_spin_chance` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `source_order_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '来源订单号',
  `rule_id` bigint unsigned DEFAULT NULL COMMENT '规则 ID',
  `deposit_amount_php` decimal(18,4) NOT NULL COMMENT '存款金额（PHP）',
  `chances_total` int unsigned NOT NULL COMMENT '总次数',
  `chances_used` int unsigned NOT NULL DEFAULT '0' COMMENT '已使用次数',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_source_order` (`source_order_id`),
  KEY `idx_user_available` (`user_id`,`chances_used`,`chances_total`),
  KEY `idx_rule_user` (`rule_id`,`user_id`),
  CONSTRAINT `fk_spin_chance_rule` FOREIGN KEY (`rule_id`) REFERENCES `bg_spin_deposit_rule` (`id`),
  CONSTRAINT `fk_spin_chance_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='转盘抽奖机会账本';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_spin_config` (
  `id` tinyint unsigned NOT NULL COMMENT '自增主键',
  `enabled` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否启用',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='转盘抽奖全局配置';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_spin_deposit_rule` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `kind` enum('deposit','checkin') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'deposit' COMMENT '类型',
  `checkin_tier` enum('starter','premium','elite') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '签到奖励档位',
  `name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '名称',
  `min_deposit_php` decimal(18,4) NOT NULL COMMENT '最低存款金额（PHP）',
  `max_deposit_php` decimal(18,4) DEFAULT NULL COMMENT '最高存款金额（PHP）',
  `chances` int unsigned NOT NULL COMMENT '发放次数',
  `enabled` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否启用',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '排序权重',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_enabled_sort` (`enabled`,`sort_order`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='转盘抽奖存款发放规则';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_spin_prize` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `rule_id` bigint unsigned DEFAULT NULL COMMENT '规则 ID',
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '奖品币种（每币种一套奖池）',
  `name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '名称',
  `image_key` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'prize-1' COMMENT '图片资源键',
  `amount_php` decimal(18,4) NOT NULL COMMENT 'PHP 金额',
  `weight` int unsigned NOT NULL COMMENT '权重',
  `turnover_x` decimal(8,2) NOT NULL DEFAULT '1.00' COMMENT '打码倍数',
  `enabled` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否启用',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '排序权重',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_enabled_sort` (`enabled`,`sort_order`),
  KEY `idx_rule_enabled_sort` (`rule_id`,`enabled`,`sort_order`),
  CONSTRAINT `fk_spin_prize_rule` FOREIGN KEY (`rule_id`) REFERENCES `bg_spin_deposit_rule` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=438 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='转盘抽奖奖品配置';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_spin_record` (
  `id` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '自增主键',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `chance_id` bigint unsigned NOT NULL COMMENT '转盘机会 ID',
  `prize_id` bigint unsigned NOT NULL COMMENT '奖品 ID',
  `prize_name` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '奖品名称',
  `amount_php` decimal(18,4) NOT NULL COMMENT 'PHP 金额',
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '派奖币种',
  `turnover_x` decimal(8,2) NOT NULL DEFAULT '1.00' COMMENT '打码倍数',
  `ledger_id` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '账变流水 ID',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_created` (`user_id`,`created_at` DESC),
  KEY `idx_created` (`created_at` DESC),
  KEY `fk_spin_record_chance` (`chance_id`),
  KEY `fk_spin_record_prize` (`prize_id`),
  CONSTRAINT `fk_spin_record_chance` FOREIGN KEY (`chance_id`) REFERENCES `bg_spin_chance` (`id`),
  CONSTRAINT `fk_spin_record_prize` FOREIGN KEY (`prize_id`) REFERENCES `bg_spin_prize` (`id`),
  CONSTRAINT `fk_spin_record_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='转盘抽奖中奖记录';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_task_claim` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `task_id` varchar(48) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '硬编码任务标识，如 daily_login/daily_deposit/profile_complete/first_withdraw/first_game/invite_1',
  `period_key` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '每日=马尼拉日期，一次性=once',
  `reward_type` enum('cash','spin','growth') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'cash' COMMENT '奖励类型',
  `currency` varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '币种代码',
  `reward_amount` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '现金奖励',
  `reward_spin` int unsigned NOT NULL DEFAULT '0' COMMENT '转盘次数奖励',
  `turnover_x` decimal(8,2) NOT NULL DEFAULT '0.00' COMMENT '现金奖励打码倍数（0=直接可提）',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_task_period` (`user_id`,`task_id`,`period_key`,`currency`),
  KEY `idx_user` (`user_id`,`task_id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=29 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务领取记录';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_task_manual_review` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `task_key` varchar(48) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '任务键',
  `currency` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP',
  `screenshot_url` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '截图 URL',
  `status` enum('pending','approved','rejected') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '业务状态',
  `reviewer` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '审核人',
  `note` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '审核备注',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `reviewed_at` datetime(3) DEFAULT NULL COMMENT '审核时间',
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`,`created_at`),
  KEY `idx_user_task` (`user_id`,`task_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='社群任务截图人工审核队列';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_task_social` (
  `task_key` varchar(48) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '任务键',
  `platform` enum('telegram','facebook','viber') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '平台',
  `verify_strategy` enum('tg_member','code_redeem','manual_review','bind_only') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '验证策略',
  `title` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '标题',
  `subtitle` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '副标题',
  `action_url` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '跳转链接（去关注/去加群）',
  `channel_ref` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT 'TG 频道 chat_id 或 @username（tg_member 用）',
  `redeem_code` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '当前轮换码（code_redeem 用，后台可改）',
  `reward_type` enum('cash','spin','growth') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'cash' COMMENT '奖励类型',
  `currency` varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '币种代码',
  `reward_by_currency` json DEFAULT NULL,
  `reward_amount` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '奖励金额',
  `reward_spin` int unsigned NOT NULL DEFAULT '0' COMMENT '奖励转盘次数',
  `turnover_x` decimal(8,2) NOT NULL DEFAULT '0.00' COMMENT '打码倍数',
  `enabled` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否启用',
  `sort` int NOT NULL DEFAULT '0' COMMENT '字段：sort',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`task_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='社群关注任务配置';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_task_social_claim` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `task_key` varchar(48) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '任务键',
  `verified_via` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT 'tg_member/code_redeem/manual_review/bind_only',
  `code_used` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT 'code_redeem 时用户回填的码（风控留痕）',
  `ip` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT 'IP 地址',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_task` (`user_id`,`task_key`),
  KEY `idx_task_time` (`task_key`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='社群任务领取记录';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_team_commission` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `beneficiary_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '佣金收益人（推荐人）',
  `from_user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'GGR 产生人（下线玩家）',
  `level` tinyint NOT NULL COMMENT '关系层级：1/2/3',
  `period` char(10) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '结算日期 YYYY-MM-DD',
  `currency` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '币种代码',
  `market` varchar(2) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PH',
  `ggr_cents` bigint NOT NULL DEFAULT '0' COMMENT '下线有效 GGR（已归零处理）',
  `rate_pct` decimal(5,2) NOT NULL COMMENT '佣金费率（%），如 25.00',
  `commission_cents` bigint NOT NULL DEFAULT '0' COMMENT '佣金金额 = ggr × rate / 100',
  `status` enum('pending','paid','voided') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '业务状态',
  `paid_at` datetime(3) DEFAULT NULL COMMENT '支付时间',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `fx_rate` decimal(12,6) NOT NULL DEFAULT '1.000000' COMMENT '汇率',
  `php_equivalent_cents` bigint NOT NULL DEFAULT '0' COMMENT '折算 PHP 金额（分）',
  `turnover_cents` bigint NOT NULL DEFAULT '0' COMMENT '有效流水金额（分）',
  `currency_breakdown` json DEFAULT NULL COMMENT '分币种明细 JSON',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_commission_market` (`beneficiary_id`,`from_user_id`,`period`,`currency`,`market`,`level`),
  KEY `idx_beneficiary_period` (`beneficiary_id`,`period`),
  KEY `idx_period_status` (`period`,`status`),
  KEY `idx_from_user` (`from_user_id`),
  KEY `idx_beneficiary_period_status` (`beneficiary_id`,`period`,`status`),
  KEY `idx_commission_market_period` (`market`,`period`,`status`),
  CONSTRAINT `fk_tc_beneficiary` FOREIGN KEY (`beneficiary_id`) REFERENCES `bg_user` (`id`),
  CONSTRAINT `fk_tc_from` FOREIGN KEY (`from_user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=14725 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='月度佣金分配明细，一条 GGR 快照最多生成 L1/L2/L3 三条记录';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_team_config` (
  `id` int NOT NULL DEFAULT '1' COMMENT '单行配置，固定 id=1',
  `l1_rate_pct` decimal(5,2) NOT NULL DEFAULT '25.00' COMMENT 'L1 佣金率（%）',
  `l2_rate_pct` decimal(5,2) NOT NULL DEFAULT '8.00' COMMENT 'L2 佣金率（%）',
  `l3_rate_pct` decimal(5,2) NOT NULL DEFAULT '3.00' COMMENT 'L3 佣金率（%）',
  `min_activation_cents` bigint NOT NULL DEFAULT '10000' COMMENT '激活门槛（分），默认 ₱100',
  `min_activation_idr_cents` bigint NOT NULL DEFAULT '2870000' COMMENT '印尼团队激活门槛（IDR分，默认Rp28,700）',
  `min_withdrawal_cents` bigint NOT NULL DEFAULT '5000' COMMENT '最低提现额（分），默认 ₱50',
  `min_withdrawal_idr_cents` bigint NOT NULL DEFAULT '1440000' COMMENT '印尼团队佣金最低转入金额（IDR分，默认Rp14,400）',
  `max_commission_per_settlement_cents` bigint DEFAULT NULL COMMENT '单次结算单用户佣金上限，NULL=不限',
  `max_commission_per_settlement_idr_cents` bigint DEFAULT NULL COMMENT '印尼单次结算佣金上限（IDR分，NULL=不限）',
  `settlement_day` tinyint NOT NULL DEFAULT '1' COMMENT '每月自动结算日（1-28），0=纯手动',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  `updated_by` int DEFAULT NULL COMMENT '最后修改的 admin_id',
  `settlement_hour` tinyint NOT NULL DEFAULT '3' COMMENT '自动结算小时',
  `last_auto_settlement` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '上次自动结算的日期（YYYY-MM-DD），防重复触发',
  `commission_basis` enum('ggr','turnover') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'turnover' COMMENT '佣金计算口径',
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
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `period` char(7) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '结算月份，如 2026-06',
  `currency` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '币种代码',
  `bet_cents` bigint NOT NULL DEFAULT '0' COMMENT '当月总投注（分）',
  `win_cents` bigint NOT NULL DEFAULT '0' COMMENT '当月总派彩（分）',
  `ggr_cents` bigint NOT NULL DEFAULT '0' COMMENT 'GGR = bet - win，可为负',
  `effective_ggr_cents` bigint NOT NULL DEFAULT '0' COMMENT '有效 GGR = MAX(ggr,0)，负月归零',
  `negative_ggr` tinyint(1) NOT NULL DEFAULT '0' COMMENT '当月 GGR 为负（玩家赢钱月）',
  `settled` tinyint(1) NOT NULL DEFAULT '0' COMMENT '佣金是否已分配完毕',
  `settled_at` datetime(3) DEFAULT NULL COMMENT '结算时间',
  `calculated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '计算时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_ggr_user_period_currency` (`user_id`,`period`,`currency`),
  KEY `idx_period_settled` (`period`,`settled`),
  CONSTRAINT `fk_tgm_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户月度 GGR 快照，负 GGR 月份有效值归零，不向上线分佣';
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
  `activation_currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '激活首充币种',
  `activated_at` datetime(3) DEFAULT NULL COMMENT '激活时间',
  `opted_in` tinyint(1) NOT NULL DEFAULT '0' COMMENT '用户已主动开启代理',
  `opted_in_at` datetime(3) DEFAULT NULL COMMENT '开启代理时间',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `rate_plan_id` int DEFAULT NULL COMMENT '佣金方案 ID',
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
CREATE TABLE `bg_team_rate_plan` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '套餐名称',
  `is_default` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否为默认套餐（C端广告展示）',
  `l1_rate_pct` decimal(5,2) NOT NULL DEFAULT '0.00' COMMENT 'L1 佣金率（%）',
  `l2_rate_pct` decimal(5,2) NOT NULL DEFAULT '0.00' COMMENT 'L2 佣金率（%）',
  `l3_rate_pct` decimal(5,2) NOT NULL DEFAULT '0.00' COMMENT 'L3 佣金率（%）',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_is_default` (`is_default`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='佣金费率套餐，is_default=1 为 C 端广告展示套餐';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_team_settlement_state` (
  `market` varchar(2) COLLATE utf8mb4_unicode_ci NOT NULL,
  `last_auto_settlement` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`market`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='团队佣金各市场自动结算进度';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_team_turnover_daily` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `date` date NOT NULL COMMENT '投注日期（PHT）',
  `currency_code` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '原始投注币种',
  `market` varchar(2) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PH',
  `bet_cents` bigint NOT NULL DEFAULT '0' COMMENT '当日投注额（原币分）',
  `settled` tinyint(1) NOT NULL DEFAULT '0' COMMENT '佣金是否已结算',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_date_currency_market` (`user_id`,`date`,`currency_code`,`market`),
  KEY `idx_date_settled` (`date`,`settled`),
  KEY `idx_market_date_settled` (`market`,`date`,`settled`),
  CONSTRAINT `fk_ttd_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=72969 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='每日投注流水快照，结算后 settled=1';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_team_wallet` (
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `available_cents` bigint NOT NULL DEFAULT '0' COMMENT '可提现余额（分）',
  `frozen_cents` bigint NOT NULL DEFAULT '0' COMMENT '提现申请冻结中（分）',
  `lifetime_earned_cents` bigint NOT NULL DEFAULT '0' COMMENT '历史累计收益（分，只增不减）',
  `version` int unsigned NOT NULL DEFAULT '0' COMMENT '乐观锁版本号',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  `currency` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '币种代码',
  PRIMARY KEY (`user_id`,`currency`),
  CONSTRAINT `fk_tw_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='佣金账户，独立于主钱包，提现时转入主钱包';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_team_withdraw_review_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `withdrawal_id` bigint unsigned NOT NULL COMMENT '佣金提现 ID',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `rule_code` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '规则代码',
  `round` tinyint unsigned NOT NULL DEFAULT '1' COMMENT '审核轮次',
  `verdict` enum('pass','manual','skipped','error') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '审核结论',
  `actual_value` decimal(18,4) DEFAULT NULL COMMENT '规则实际值',
  `threshold` decimal(18,4) DEFAULT NULL COMMENT '阈值',
  `detail` json DEFAULT NULL COMMENT '明细 JSON',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_withdrawal_round` (`withdrawal_id`,`round`),
  KEY `idx_rule_time` (`rule_code`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=25 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='佣金提现自动审核逐规则结果';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_team_withdrawal` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP',
  `amount_cents` bigint NOT NULL COMMENT '提现金额（分）',
  `status` enum('pending','approved','rejected') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '业务状态',
  `review_verdict` enum('pass','manual') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual' COMMENT '审核结论，佣金提现固定 manual',
  `admin_id` int DEFAULT NULL COMMENT '审核管理员 bg_admin.id',
  `reject_reason` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '拒绝原因',
  `reviewed_at` datetime(3) DEFAULT NULL COMMENT '审核时间',
  `review_round` tinyint unsigned DEFAULT NULL COMMENT '当前审核轮次',
  `review_ms` int DEFAULT NULL COMMENT '审核耗时(ms)',
  `review_snapshot` json DEFAULT NULL COMMENT '审核当时的上下文快照',
  `handled_by` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '处理人 admin username',
  `handled_at` datetime(3) DEFAULT NULL COMMENT '人工处理时间',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_status` (`user_id`,`status`),
  KEY `idx_status_created` (`status`,`created_at` DESC),
  KEY `idx_user_currency_status` (`user_id`,`currency`,`status`),
  CONSTRAINT `fk_twd_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='佣金提现申请，Admin 审核后转入主钱包';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_turnover_allocations` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `log_id` bigint unsigned NOT NULL COMMENT '流水日志 ID',
  `requirement_id` bigint unsigned NOT NULL COMMENT '流水要求 ID',
  `allocated_amount` decimal(18,4) NOT NULL COMMENT '分配金额',
  PRIMARY KEY (`id`),
  KEY `idx_log` (`log_id`),
  KEY `idx_requirement` (`requirement_id`)
) ENGINE=InnoDB AUTO_INCREMENT=524 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='流水要求分配明细';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_turnover_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `currency` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '币种代码',
  `bet_order_id` bigint unsigned NOT NULL COMMENT 'å…³è” bg_bet_order.id',
  `bet_amount` decimal(18,4) NOT NULL COMMENT '投注金额',
  `rate` decimal(5,4) NOT NULL DEFAULT '1.0000' COMMENT '倍率',
  `effective_amount` decimal(18,4) NOT NULL COMMENT 'bet_amount * rateï¼Œå®žé™…è®¡å…¥çš„æµæ°´é¢',
  `sort_category` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '前端分类',
  `is_reversed` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否已冲正',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bet_order` (`bet_order_id`),
  KEY `idx_user_created` (`user_id`,`created_at` DESC)
) ENGINE=InnoDB AUTO_INCREMENT=648942 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='投注流水明细';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_turnover_requirements` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `currency` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '币种代码',
  `source_type` enum('deposit','promotion') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '来源类型',
  `source_ref` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'å­˜æ¬¾ orderId æˆ–ä¼˜æƒ ç±»åž‹(trial/referral/firstdep)',
  `base_amount` decimal(18,4) DEFAULT NULL COMMENT '本金：存款入账额或彩金入账额',
  `required_amount` decimal(18,4) NOT NULL COMMENT '要求完成金额',
  `completed_amount` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '已完成金额',
  `status` enum('pending','completed','expired','cancelled') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '业务状态',
  `expires_at` datetime DEFAULT NULL COMMENT 'ä»…ä¼˜æƒ ç±»è¦æ±‚æœ‰æœ‰æ•ˆæœŸï¼ŒNULL=æ°¸ä¹…',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_status` (`user_id`,`status`),
  KEY `idx_expires` (`expires_at`,`status`),
  KEY `idx_turnover_req_user_currency_status` (`user_id`,`currency`,`status`)
) ENGINE=InnoDB AUTO_INCREMENT=143 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户流水要求';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_user` (
  `id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '平台用户ID，如 BG-10001',
  `email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '用户邮箱',
  `display_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '昵称/展示名',
  `avatar_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '头像地址',
  `invite_code` char(8) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '邀请码，唯一',
  `inviter_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '邀请人 bg_user.id',
  `locale` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'en' COMMENT 'en|id|vi|zh-CN',
  `market` varchar(2) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PH',
  `status` enum('active','frozen','banned') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT '账号状态',
  `label` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'normal' COMMENT '用户标签: normal | arbitrage',
  `kyc_doc_override` tinyint(1) DEFAULT NULL COMMENT 'KYC证件校验覆盖：NULL跟随系统/1强制开/0强制关',
  `kyc_face_override` tinyint(1) DEFAULT NULL COMMENT 'KYC人脸校验覆盖：NULL跟随系统/1强制开/0强制关',
  `status_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '状态变更原因',
  `registered_at` datetime(3) NOT NULL COMMENT '注册时间',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '记录创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '记录更新时间',
  `last_login_at` datetime(3) DEFAULT NULL COMMENT '最后登录时间',
  `register_ip` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '注册 IP',
  `register_region` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '注册地区',
  `register_entry_source` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '注册入口域名或 tma',
  `register_device_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '注册时的设备ID',
  `last_login_ip` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最后登录 IP',
  `last_login_region` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最后登录地区',
  `last_platform` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最近登录客户端平台 web/app/pwa/telegram',
  `birthday` date DEFAULT NULL COMMENT '生日（一次性设置，用于 VIP 生日礼金）',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_invite_code` (`invite_code`),
  UNIQUE KEY `uk_email` (`email`),
  KEY `idx_inviter_id` (`inviter_id`),
  KEY `idx_status` (`status`),
  KEY `idx_user_register_device` (`register_device_id`),
  KEY `idx_user_register_entry_source` (`register_entry_source`),
  KEY `idx_registered` (`registered_at`),
  KEY `idx_user_market` (`market`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户主表';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_user_agent` (
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `agent_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联渠道代理 ID',
  `source` enum('domain','bot','manual') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '来源',
  `bound_by` int DEFAULT NULL COMMENT '手动绑定时的管理员ID',
  `bound_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '绑定时间',
  PRIMARY KEY (`user_id`),
  KEY `idx_agent` (`agent_id`),
  CONSTRAINT `fk_ua_agent` FOREIGN KEY (`agent_id`) REFERENCES `bg_agent` (`agent_id`),
  CONSTRAINT `fk_ua_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户归属代理，一人一代理，与邀请关系独立';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_user_attribution` (
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `channel_code` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '结算渠道标识(投手/像素)，取自 ?c= 或 utm_source',
  `utm_source` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `utm_medium` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `utm_campaign` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `utm_content` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `utm_term` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `click_platform` enum('facebook','tiktok','google','other') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'other',
  `click_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'fbclid / ttclid 原值',
  `fbp` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '_fbp cookie，FB CAPI 匹配用',
  `fbc` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '_fbc cookie，FB CAPI 匹配用',
  `ttp` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '_ttp cookie，TikTok CAPI 匹配用',
  `fb_pixel_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tt_pixel_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `landing_host` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `landing_path` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `referrer` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_agent` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `client_ip` varchar(45) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  KEY `idx_channel_created` (`channel_code`,`created_at`),
  KEY `idx_campaign` (`utm_campaign`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='买量归因：注册来源快照';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_user_id_seq` (
  `n` bigint unsigned NOT NULL AUTO_INCREMENT,
  `stub` char(1) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`n`),
  UNIQUE KEY `uk_stub` (`stub`)
) ENGINE=InnoDB AUTO_INCREMENT=11517 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户ID取号器（恒一行，REPLACE 取号）';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_user_identity` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `provider` enum('phone','google','telegram','telegram_oidc') COLLATE utf8mb4_unicode_ci NOT NULL,
  `identifier` varchar(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '字段：identifier',
  `credential_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '字段：credential_hash',
  `display_label` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '字段：display_label',
  `verified_at` datetime(3) DEFAULT NULL COMMENT '字段：verified_at',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_provider_identifier` (`provider`,`identifier`),
  KEY `idx_user_provider` (`user_id`,`provider`),
  CONSTRAINT `fk_user_identity_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=1691 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户登录身份';
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
CREATE TABLE `bg_user_risk_signal` (
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bonus_total` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '累计彩金（trial+firstdep+appdl+task现金+转盘，PHP）',
  `net_deposit` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '累计成功充值（PHP）',
  `bonus_ratio` decimal(10,4) NOT NULL DEFAULT '0.0000' COMMENT '彩金/充值，无充值且有彩金时为 9999',
  `withdraw_count` int NOT NULL DEFAULT '0' COMMENT '成功提现笔数',
  `device_shared_users` int NOT NULL DEFAULT '1' COMMENT '同 device_id 关联的账号数',
  `ip_shared_users` int NOT NULL DEFAULT '1' COMMENT '同 IP 关联的账号数',
  `risk_score` tinyint unsigned NOT NULL DEFAULT '0' COMMENT '0-100 综合风险分',
  `signals` json DEFAULT NULL COMMENT '原始明细快照',
  `computed_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`user_id`),
  KEY `idx_risk_score` (`risk_score`),
  KEY `idx_bonus_ratio` (`bonus_ratio`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户风险信号快照（每日重算）';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_user_segment` (
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `lifecycle` enum('new','active','dormant','churned') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'new' COMMENT '生命周期：新客/活跃/沉睡/流失',
  `deposited` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否充过值',
  `value_tier` enum('none','low','mid','high','vip') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'none' COMMENT '累计充值价值档',
  `is_agent` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否 3-Circle 已激活代理',
  `reachable_tg` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否可 Telegram bot 触达（有 telegram_user_id）',
  `total_deposit` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '累计充值（PHP，等价 credited_cents 单位）',
  `deposit_count` int NOT NULL DEFAULT '0' COMMENT '成功充值笔数',
  `last_active_at` datetime(3) DEFAULT NULL COMMENT '最近活跃时间（登录/充值取大）',
  `days_since_active` int DEFAULT NULL COMMENT '距今未活跃天数（重算时快照）',
  `computed_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '计算时间',
  PRIMARY KEY (`user_id`),
  KEY `idx_lifecycle` (`lifecycle`),
  KEY `idx_value_tier` (`value_tier`),
  KEY `idx_deposited` (`deposited`),
  KEY `idx_reachable_tg` (`reachable_tg`),
  KEY `idx_is_agent` (`is_agent`),
  CONSTRAINT `fk_segment_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户分层快照（每日重算，供触达定向）';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_user_tag` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tag_code` varchar(48) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'risk.bonus_abuse | risk.multi_account | risk.arbitrage ...',
  `source` enum('auto','manual') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'auto' COMMENT '自动跑批 / 运营人工',
  `confidence` tinyint unsigned NOT NULL DEFAULT '0' COMMENT '0-100，manual 恒为 100',
  `evidence` json DEFAULT NULL COMMENT '命中时的具体数值，供运营复核与用户申诉',
  `assigned_by` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'manual 时的管理员用户名',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_user_tag` (`user_id`,`tag_code`),
  KEY `idx_tag_code` (`tag_code`),
  KEY `idx_source` (`source`)
) ENGINE=InnoDB AUTO_INCREMENT=908 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户风控标签（人工优先于自动）';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_user_vip_state` (
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '币种（每币种一套等级状态）',
  `current_level` tinyint NOT NULL DEFAULT '1' COMMENT '权威等级（可因保级失败下降）',
  `awarded_level` tinyint NOT NULL DEFAULT '1' COMMENT '历史最高等级（累计流水爬升，单调不降）',
  `quarter_key` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '当前保级考核季度，如 2026-Q3',
  `quarter_start_turnover` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '本季度起点的累计有效流水快照',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  `task_growth` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '任务累计喂入的成长值（等效有效流水，加速升级）',
  `turnover_total` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '有效流水累计（is_reversed=0 口径，写侧事务内增量维护）',
  PRIMARY KEY (`user_id`,`currency`),
  KEY `idx_quarter` (`quarter_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户 VIP 等级状态（支持保级降级）';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_vip_level_benefit` (
  `level` tinyint NOT NULL COMMENT 'VIP 等级 1–9（复用洗码等级）',
  `currency` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '币种（每币种一套权益数值）',
  `promotion_bonus` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '晋级礼金（升到该级一次性发放）',
  `weekly_salary` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '周俸（二期启用）',
  `monthly_salary` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '月俸（二期启用）',
  `birthday_bonus` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '生日礼金',
  `negative_rebate_pct` decimal(5,3) NOT NULL DEFAULT '0.000' COMMENT '负盈利返水率 %（按周净输返还）',
  `retention_line` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '保级线（季度有效流水，二期启用）',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  `withdraw_daily_limit` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '专属每日提现额度上限（0=不额外提升）',
  `withdraw_daily_count` int NOT NULL DEFAULT '0' COMMENT '专属每日提现次数上限（0=不额外提升）',
  PRIMARY KEY (`level`,`currency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='VIP 每级权益配置（后台可调整）';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_vip_reward_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `level` tinyint NOT NULL COMMENT '发放时用户等级',
  `type` enum('promotion','weekly','monthly','negative_rebate','birthday') COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '礼金类型',
  `amount` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT '发放金额',
  `currency_code` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '币种代码',
  `period_key` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '幂等周期键：晋级=L{级}，周=ISO周一日期，月=YYYY-MM',
  `status` enum('pending','paid') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '业务状态',
  `expire_at` datetime(3) DEFAULT NULL COMMENT '领取截止（二期周俸/月俸限时用），NULL=不过期',
  `paid_at` datetime(3) DEFAULT NULL COMMENT '支付时间',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_type_period_cur` (`user_id`,`type`,`period_key`,`currency_code`),
  KEY `idx_user_status` (`user_id`,`status`),
  KEY `idx_type_period` (`type`,`period_key`)
) ENGINE=InnoDB AUTO_INCREMENT=361 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='VIP 礼金发放记录（pending 待领取 / paid 已领取）';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_virtual_game_config` (
  `uuid` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '虚拟游戏入口 uuid',
  `provider` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name_zh` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `category` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sort_category` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `site_category` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `weight` int NOT NULL DEFAULT '10000',
  `is_featured` tinyint(1) NOT NULL DEFAULT '1',
  `image_override` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `image_source` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `supported_currencies` json DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`uuid`),
  KEY `idx_active_category` (`is_active`,`site_category`),
  KEY `idx_sort_category` (`sort_category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='虚拟游戏入口运营配置';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_wallet` (
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联 bg_user.id',
  `currency` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '币种代码',
  `available` decimal(18,6) NOT NULL DEFAULT '0.000000' COMMENT '可用余额',
  `frozen` decimal(18,6) NOT NULL DEFAULT '0.000000' COMMENT '冻结金额',
  `version` int NOT NULL DEFAULT '0' COMMENT '乐观锁版本号',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '最后变动时间',
  PRIMARY KEY (`user_id`,`currency`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户钱包余额（多币种）';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_wallet_ledger` (
  `id` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '流水ID',
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联 bg_user.id',
  `currency` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '币种代码',
  `type` enum('deposit','withdraw','bet','win','red_packet','bonus','adjust','admin_adjust','rebate','vip_bonus','task_bonus') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '类型',
  `amount` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '账变金额（PHP 元，正负）',
  `balance_after` decimal(18,6) NOT NULL COMMENT '本次记账后可用余额快照',
  `ref_type` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'deposit_order|withdraw_order|bet_order|promo',
  `ref_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联单号，如 order_id / round_id',
  `description` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '账变描述',
  `trace_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '请求链路 ID',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_created` (`user_id`,`created_at` DESC),
  KEY `idx_ref` (`ref_type`,`ref_id`),
  KEY `idx_type` (`type`),
  KEY `idx_created` (`created_at`),
  KEY `idx_amount_created` (`amount`,`created_at`),
  CONSTRAINT `fk_ledger_user` FOREIGN KEY (`user_id`) REFERENCES `bg_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='钱包流水（只追加）';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_withdraw_order` (
  `order_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '订单号',
  `user_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `channel` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '通道代码',
  `currency` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '币种代码',
  `amount` decimal(18,6) NOT NULL COMMENT '金额',
  `status` enum('pending','processing','completed','failed','rejected','admin_rejected') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT '业务状态',
  `review_verdict` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '自动审核结论: pass(自动通过) | manual(转人工) | NULL(未审)',
  `reviewed_at` datetime(3) DEFAULT NULL COMMENT '自动审核时间',
  `review_round` tinyint unsigned DEFAULT NULL COMMENT '当前审核轮次',
  `review_ms` int DEFAULT NULL COMMENT '审核耗时(ms)',
  `review_snapshot` json DEFAULT NULL COMMENT '审核当时的上下文快照（防窗口漂移）',
  `handled_by` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '人工处理人(管理员用户名)',
  `handled_at` datetime(3) DEFAULT NULL COMMENT '人工处理时间',
  `badge_ignored` tinyint(1) NOT NULL DEFAULT '0' COMMENT '后台已忽略该提款转人工提案提醒(1=忽略)',
  `to_address` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '收款地址',
  `chain` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '链网络',
  `refunded` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否已退款',
  `reject_reason` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '拒绝原因',
  `reject_reason_user` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '用户可见提款拒绝原因',
  `extra` json DEFAULT NULL COMMENT '扩展数据 JSON',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`order_id`),
  KEY `idx_user_created` (`user_id`,`created_at`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='提款订单';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_withdraw_review_config` (
  `rule_code` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '规则代码',
  `scope` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'user' COMMENT '业务域: user(玩家提款) | team(佣金提现)',
  `enabled` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否启用',
  `threshold` decimal(18,4) DEFAULT NULL COMMENT '主阈值（单一参数规则用）',
  `params` json DEFAULT NULL COMMENT '多参数规则的配置（如分币种阈值）',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`scope`,`rule_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='取款自动审核规则配置';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bg_withdraw_review_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `order_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '提款订单号',
  `user_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联用户 ID',
  `rule_code` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '规则代码',
  `round` tinyint unsigned NOT NULL DEFAULT '1' COMMENT '审核轮次（重跑递增）',
  `verdict` enum('pass','manual','skipped','error') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '审核结论',
  `actual_value` decimal(18,4) DEFAULT NULL COMMENT '规则计算出的实际值',
  `threshold` decimal(18,4) DEFAULT NULL COMMENT '命中时对照的阈值',
  `detail` json DEFAULT NULL COMMENT '附加上下文',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_order` (`order_id`),
  KEY `idx_rule_time` (`rule_code`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=430 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='取款自动审核逐规则结果';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bi_alert` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `stat_date` date NOT NULL,
  `alert_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'provider_rtp|channel_success|ggr|withdraw|new_users',
  `dimension` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '维度值,如厂商名/通道名',
  `currency` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `value` decimal(18,4) NOT NULL,
  `baseline` decimal(18,4) NOT NULL,
  `deviation` decimal(8,2) NOT NULL COMMENT 'z-score',
  `severity` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'warn' COMMENT 'warn|critical',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open' COMMENT 'open|ack|closed',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_alert` (`stat_date`,`alert_type`,`dimension`,`currency`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 异常告警(P2 起使用)';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bi_daily_acquisition` (
  `stat_date` date NOT NULL,
  `entry_source` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '入口域名或tma,空=unknown',
  `new_users` int NOT NULL DEFAULT '0' COMMENT '按注册入口归因',
  `dau` int NOT NULL DEFAULT '0' COMMENT '按当日登录入口归因',
  `first_dep_users` int NOT NULL DEFAULT '0' COMMENT '首充人数,按注册入口归因',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`stat_date`,`entry_source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 渠道(域名/tma)日聚合';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bi_daily_active` (
  `stat_date` date NOT NULL,
  `market` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ALL',
  `new_users` int NOT NULL DEFAULT '0' COMMENT '当日注册数',
  `dau` int NOT NULL DEFAULT '0' COMMENT '当日活跃=登录∪投注∪充值 去重',
  `login_count` int NOT NULL DEFAULT '0' COMMENT '当日登录次数',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`stat_date`,`market`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 用户活跃日聚合(不分币种)';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bi_daily_channel` (
  `stat_date` date NOT NULL,
  `direction` enum('deposit','withdraw') COLLATE utf8mb4_unicode_ci NOT NULL,
  `channel` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `total` int NOT NULL DEFAULT '0' COMMENT '当日终态订单数(充值:paid/failed/rejected/admin_rejected;提现:completed/failed/rejected/admin_rejected)',
  `success` int NOT NULL DEFAULT '0',
  `avg_secs` int DEFAULT NULL COMMENT '成功单平均处理秒数',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`stat_date`,`direction`,`channel`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 支付通道日聚合';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bi_daily_exchange_rate` (
  `stat_date` date NOT NULL,
  `currency` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rate_to_usdt` decimal(24,12) NOT NULL COMMENT '1 原币折合 USDT',
  `source` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'exchange_rate',
  `captured_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`stat_date`,`currency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 每日原币兑 USDT 汇率快照';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bi_daily_game` (
  `stat_date` date NOT NULL,
  `game_provider_id` int NOT NULL COMMENT '=bg_568win_game.game_provider_id(gpid)',
  `game_id` int NOT NULL COMMENT '=bg_568win_game.game_id',
  `currency` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bet_count` int NOT NULL DEFAULT '0',
  `bet_users` int NOT NULL DEFAULT '0',
  `bet_amount` decimal(18,4) NOT NULL DEFAULT '0.0000',
  `payout_amount` decimal(18,4) NOT NULL DEFAULT '0.0000',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`stat_date`,`game_provider_id`,`game_id`,`currency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 游戏日聚合,游戏名读时join';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bi_daily_platform` (
  `stat_date` date NOT NULL,
  `currency` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `deposit_amount` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '当日已支付充值总额',
  `deposit_count` int NOT NULL DEFAULT '0',
  `deposit_users` int NOT NULL DEFAULT '0' COMMENT '充值人数(去重)',
  `withdraw_amount` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '当日提现总额(completed+processing)',
  `withdraw_count` int NOT NULL DEFAULT '0',
  `bet_amount` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '当日投注总额(非void)',
  `payout_amount` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '当日派彩总额(settled win_loss,含本金)',
  `bet_count` int NOT NULL DEFAULT '0',
  `bet_users` int NOT NULL DEFAULT '0' COMMENT '投注人数(去重)',
  `bonus_cost` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '活动成本=ledger bonus/red_packet/rebate/vip_bonus/task_bonus 正数合计',
  `first_dep_users` int NOT NULL DEFAULT '0' COMMENT '首充人数(平台首笔已支付充值发生在当日)',
  `first_dep_amount` decimal(18,4) NOT NULL DEFAULT '0.0000',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`stat_date`,`currency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 平台日聚合(按币种)';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bi_daily_provider` (
  `stat_date` date NOT NULL,
  `provider` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '厂商规范名(bg_568win_game.provider),未匹配=Unknown',
  `currency` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bet_count` int NOT NULL DEFAULT '0',
  `bet_users` int NOT NULL DEFAULT '0',
  `bet_amount` decimal(18,4) NOT NULL DEFAULT '0.0000',
  `payout_amount` decimal(18,4) NOT NULL DEFAULT '0.0000',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`stat_date`,`provider`,`currency`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 游戏厂商日聚合';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bi_daily_user` (
  `stat_date` date NOT NULL,
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `currency` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bet_amount` decimal(18,4) NOT NULL DEFAULT '0.0000',
  `payout_amount` decimal(18,4) NOT NULL DEFAULT '0.0000',
  `bet_count` int NOT NULL DEFAULT '0',
  `deposit_amount` decimal(18,4) NOT NULL DEFAULT '0.0000',
  `withdraw_amount` decimal(18,4) NOT NULL DEFAULT '0.0000',
  `bonus_amount` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT '当日领取彩金(ledger bonus类正数)',
  PRIMARY KEY (`stat_date`,`user_id`,`currency`),
  KEY `idx_user` (`user_id`,`stat_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 用户日聚合(有资金行为)';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bi_target` (
  `period` char(7) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '月份 YYYY-MM',
  `market` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ALL',
  `metric` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'ggr|deposit|new_users|first_dep_users',
  `target_value` decimal(18,4) NOT NULL,
  `created_by` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`period`,`market`,`metric`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 月度运营目标(P4 使用)';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bi_user_active_day` (
  `stat_date` date NOT NULL,
  `user_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`stat_date`,`user_id`),
  KEY `idx_user` (`user_id`,`stat_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='BI 用户活跃日(登录∪投注∪充值),留存用';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cm_channel` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `platform` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'telegram | viber | facebook',
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '后台显示名,如 "BetoGo TG 主频道"',
  `config` json NOT NULL COMMENT 'telegram:{chatId,botToken?} viber:{authToken,from} facebook:{pageId,pageToken?}',
  `daily_limit` int unsigned NOT NULL DEFAULT '10' COMMENT '单渠道每日发帖上限,防配置失误刷屏',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cm_post_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `rule_id` int unsigned DEFAULT NULL COMMENT 'NULL=后台手动发送',
  `channel_id` int unsigned NOT NULL,
  `template_id` int unsigned DEFAULT NULL,
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '实发内容快照(AI 改写后)',
  `image_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `buttons` json DEFAULT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT 'pending(FB待人工确认) | sent | failed | skipped',
  `error` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sent_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_channel_day` (`channel_id`,`created_at`),
  KEY `idx_status` (`status`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=28 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cm_rule` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '从该栏目模板池轮换',
  `channel_ids` json NOT NULL COMMENT '目标渠道 id 数组',
  `slots` json NOT NULL COMMENT '每日发送时刻(PHT) ["10:00","19:00"]',
  `strategy` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'sequential' COMMENT 'sequential | random',
  `ai_rewrite` tinyint(1) NOT NULL DEFAULT '1' COMMENT '发送前是否 AI 变体改写',
  `cursor` int unsigned NOT NULL DEFAULT '0' COMMENT 'sequential 轮换游标',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cm_template` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `category` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'promo | winner | hotgame | sports | checkin | festival',
  `title` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '后台管理用名称',
  `body` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '文案,支持变量 {player} {amount} {game} {game1..3} {date}',
  `image_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `buttons` json DEFAULT NULL COMMENT '[{text,url}] TG inline按钮;FB/Viber 追加为文末链接',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `sort` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_category` (`category`,`enabled`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cs_conversation` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `user_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联 bg_user.id',
  `status` enum('active','escalated','human_taken','resolved','closed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' COMMENT '业务状态',
  `assigned_admin_id` int unsigned DEFAULT NULL COMMENT '接管的管理员 ID',
  `agent_name` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `escalate_reason` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '字段：escalate_reason',
  `escalated_at` datetime DEFAULT NULL COMMENT '字段：escalated_at',
  `user_left_at` datetime DEFAULT NULL,
  `user_ticket_read_message_id` bigint unsigned NOT NULL DEFAULT '0' COMMENT '用户侧工单已读到的 cs_message.id',
  `badge_ignored` tinyint(1) NOT NULL DEFAULT '0' COMMENT '后台已忽略该客服工单提醒(1=忽略)',
  `ai_summary` text COLLATE utf8mb4_unicode_ci COMMENT '客服 AI 总结内容',
  `ai_summary_model` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '生成总结的模型',
  `ai_summary_message_count` int unsigned NOT NULL DEFAULT '0' COMMENT '生成总结时使用的消息数',
  `ai_summary_updated_at` datetime DEFAULT NULL COMMENT 'AI 总结更新时间',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `resolved_at` datetime DEFAULT NULL COMMENT '解决时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_updated_at` (`updated_at`)
) ENGINE=InnoDB AUTO_INCREMENT=39 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客服会话';
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
) ENGINE=InnoDB AUTO_INCREMENT=52 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客服 FAQ 知识库';
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
) ENGINE=InnoDB AUTO_INCREMENT=239 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客服消息';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payment_channel_rules` (
  `id` int unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `channel_id` int unsigned NOT NULL COMMENT '支付渠道 ID',
  `currency` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PHP' COMMENT '币种代码',
  `tx_type` enum('deposit','withdraw','both') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'both' COMMENT '适用交易类型：充值/提现/两者',
  `amount_min` decimal(18,2) DEFAULT NULL COMMENT 'NULL 表示无下限',
  `amount_max` decimal(18,2) DEFAULT NULL COMMENT 'NULL 表示无上限',
  `weight` int unsigned NOT NULL DEFAULT '100' COMMENT '权重',
  `enabled` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否启用',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `fk_pcr_channel` (`channel_id`),
  CONSTRAINT `fk_pcr_channel` FOREIGN KEY (`channel_id`) REFERENCES `payment_channels` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=43 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='支付渠道路由规则';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payment_channels` (
  `id` int unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'gcash / maya / etc',
  `provider` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'beepay / yfpay / etc',
  `label` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '后台显示名称',
  `enabled` tinyint(1) NOT NULL DEFAULT '1' COMMENT '是否启用',
  `client_visible` tinyint(1) NOT NULL DEFAULT '1',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '排序权重',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `category` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'fiat' COMMENT 'fiat | crypto',
  `deposit_fee_type` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'none' COMMENT 'none | percent | fixed',
  `deposit_fee_value` decimal(18,6) NOT NULL DEFAULT '0.000000' COMMENT '充值手续费数值',
  `withdraw_fee_type` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'none' COMMENT '提现手续费类型',
  `withdraw_fee_value` decimal(18,6) NOT NULL DEFAULT '0.000000' COMMENT '提现手续费数值',
  `withdraw_min` decimal(18,2) DEFAULT NULL COMMENT '虚拟币单笔提现最低额(NULL=不限)',
  `withdraw_max` decimal(18,2) DEFAULT NULL COMMENT '虚拟币单笔提现最高额(NULL=不限)',
  `withdraw_gas_fee` decimal(18,8) NOT NULL DEFAULT '0.00000000' COMMENT '虚拟币提现用户额外承担的gas费(币种单位)',
  `withdraw_gas_discount_threshold` decimal(18,8) DEFAULT NULL COMMENT '虚拟币提现 gas 优惠门槛，NULL=无优惠档位',
  `withdraw_gas_discount_fee` decimal(18,8) DEFAULT NULL COMMENT '虚拟币提现优惠 gas 费，NULL=无优惠档位',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_name_provider` (`name`,`provider`)
) ENGINE=InnoDB AUTO_INCREMENT=36 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='支付渠道配置';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `provider_balance_snapshot` (
  `provider` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '服务商或供应商代码',
  `balance` decimal(18,6) NOT NULL DEFAULT '0.000000' COMMENT '余额',
  `frozen` decimal(18,6) NOT NULL DEFAULT '0.000000' COMMENT '冻结金额',
  `currency` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'PHP' COMMENT '币种代码',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'ok' COMMENT '业务状态',
  `error_msg` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL COMMENT '余额查询错误信息',
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`provider`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='支付服务商余额快照';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `provider_balance_snapshot_history` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `provider` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '服务商或供应商代码',
  `balance` decimal(18,6) DEFAULT NULL COMMENT '余额',
  `frozen` decimal(18,6) DEFAULT NULL COMMENT '冻结金额',
  `currency` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL DEFAULT 'PHP' COMMENT '币种代码',
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL COMMENT '业务状态',
  `error_msg` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci DEFAULT NULL COMMENT '字段：error_msg',
  `raw_response` json DEFAULT NULL COMMENT '服务商余额原始响应',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  KEY `idx_provider_created_at` (`provider`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=4319 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='支付服务商余额快照历史';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `schema_migrations` (
  `version` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '迁移版本号',
  `executed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '迁移执行时间',
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='数据库迁移执行记录';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tg_broadcast` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `title` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '后台管理用名称',
  `content` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '文案,支持 Telegram HTML(<b> <i> <a>)',
  `image_key` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '本地存储 key(home/broadcast/…),NULL=纯文字',
  `buttons` json DEFAULT NULL COMMENT '[{text,kind:url|webapp,url}] 每按钮一行',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft' COMMENT 'draft | sending | done | canceled',
  `total` int unsigned NOT NULL DEFAULT '0' COMMENT '开始发送时快照的受众数',
  `sent_count` int unsigned NOT NULL DEFAULT '0',
  `failed_count` int unsigned NOT NULL DEFAULT '0' COMMENT '发送失败(非拉黑)',
  `blocked_count` int unsigned NOT NULL DEFAULT '0' COMMENT '拉黑 bot / 从未 start / 账号注销',
  `cursor_id` bigint unsigned NOT NULL DEFAULT '0' COMMENT '已处理到的 bg_user_identity.id,断点续发',
  `tg_file_id` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '首次上传图片后 Telegram 返回的 file_id,后续复用免重传',
  `created_by` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `started_at` timestamp NULL DEFAULT NULL,
  `finished_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tg_broadcast_fail` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `broadcast_id` int unsigned NOT NULL,
  `tg_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `user_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `blocked` tinyint(1) NOT NULL DEFAULT '0' COMMENT '1=拉黑/未start/注销,0=其他失败',
  `error` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_broadcast` (`broadcast_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- 已执行版本：新库据此认为基线内的迁移都已应用，之后的新迁移照常增量执行

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

/*!40000 ALTER TABLE `schema_migrations` DISABLE KEYS */;
INSERT INTO `schema_migrations` VALUES ('001_schema','2026-06-12 03:02:53'),('002_payment_order','2026-06-12 03:02:53'),('003_sg_games','2026-06-12 03:02:54'),('004_admin','2026-06-12 03:02:54'),('005_user_activity','2026-06-12 03:02:54'),('006_admin_settings_geo','2026-06-12 03:02:54'),('007_wallet_ledger_admin_adjust','2026-06-12 03:02:54'),('008_consolidate_order_tables','2026-06-12 03:02:55'),('009_fix_comments_and_cleanup','2026-06-12 03:02:55'),('010_drop_legacy_order_tables','2026-06-12 03:02:55'),('011_alter_columns','2026-06-12 03:02:55'),('012_cs_tables','2026-06-12 03:02:56'),('013_cs_user_id_varchar','2026-06-12 03:02:56'),('014_currency_settlement','2026-06-12 03:02:56'),('015_add_column_comments','2026-06-12 03:02:56'),('016_unify_amounts_to_yuan','2026-06-12 03:02:56'),('017_sg_games_expand','2026-06-12 03:02:57'),('018_sg_games_enrichment','2026-06-12 03:02:57'),('019_fix_faq_encoding','2026-06-12 03:02:57'),('020_sg_games_weight_breakdown','2026-06-12 03:02:57'),('021_sg_games_ph_bonus_column','2026-06-12 03:02:58'),('022_fix_bingo_sort_category','2026-06-12 03:02:58'),('023_pinoy_sort_category','2026-06-12 03:02:58'),('024_game_name_i18n','2026-06-12 03:02:58'),('025_matrix_orders','2026-06-12 03:02:58'),('026_team_node','2026-06-12 03:02:59'),('027_team_optin','2026-06-12 03:02:59'),('028_wallet_ledger_team_type','2026-06-12 03:02:59'),('029_team_indexes','2026-06-12 03:02:59'),('030_drop_payment_order','2026-06-12 03:03:00'),('031_multicurrency_wallet','2026-06-12 03:03:00'),('032_drop_old_order_tables','2026-06-12 03:03:00'),('033_fix_collation','2026-06-12 03:03:00'),('034_add_admin_rejected_status','2026-06-12 03:03:00'),('035_promo_config','2026-06-12 03:03:01'),('036_turnover_system','2026-06-12 03:03:01'),('037_multi_currency','2026-06-12 03:03:01'),('038_commission_fx','2026-06-12 03:03:01'),('039_fix_commission_unique_key','2026-06-12 03:03:02'),('040_bet_order_currency_varchar','2026-06-12 03:03:02'),('041_currency_code_varchar16','2026-06-12 03:03:02'),('042_currency_code_varchar32','2026-06-12 03:03:02'),('043_drop_dead_tables','2026-06-12 03:03:03'),('044_daily_turnover_settlement','2026-06-12 03:03:03'),('045_turnover_currency_varchar32','2026-06-12 03:03:03'),('046_fix_table_comments','2026-06-12 03:03:03'),('047_fix_table_comments_utf8','2026-06-12 03:03:03'),('048_commission_period_char10','2026-06-12 03:03:04'),('049_update_default_rate_plan','2026-06-12 08:36:40'),('050_rebate_system','2026-06-13 01:49:56'),('051_auth_password','2026-06-13 12:34:34'),('052_kyc','2026-06-13 12:56:58'),('053_email_unique','2026-06-13 17:57:34'),('054_telegram_oidc_sub','2026-06-14 08:17:32'),('055_withdraw_auto_review','2026-06-14 08:35:53'),('056_withdraw_review_module','2026-06-14 09:05:39'),('057_kyc_steps','2026-06-14 11:05:02'),('058_kyc_reviewed_by','2026-06-14 11:26:28'),('059_kyc_user_override','2026-06-14 12:44:23'),('060_kyc_doc_log','2026-06-15 01:03:27'),('061_team_withdrawal_review','2026-06-15 01:32:48'),('062_payment_channels','2026-06-15 09:53:41'),('063_payment_rule_tx_type','2026-06-15 10:07:30'),('064_payment_channel_category','2026-06-15 13:15:19'),('065_provider_balance_snapshot','2026-06-15 16:12:32'),('066_rebate_levels','2026-06-16 02:39:32'),('067_rebate_max_bonus','2026-06-16 05:37:19'),('068_rewards_spin','2026-06-17 07:07:37'),('069_spin_tiers','2026-06-17 07:24:42'),('070_yfpay_withdraw_limits','2026-06-17 11:43:16'),('071_spin_fixed_levels','2026-06-17 14:49:00'),('072_spin_high_level_prizes','2026-06-18 01:57:18'),('073_drop_dead_promo_game_session','2026-06-18 12:07:13'),('074_provider_balance_snapshot_history','2026-06-19 01:38:20'),('075_payment_channel_fees','2026-06-19 01:49:43'),('076_agent','2026-06-19 04:27:43'),('077_agent_channel_registry','2026-06-19 12:35:17'),('078_drop_sg_settlement_report','2026-06-19 07:56:45'),('079_team_withdraw_auto_review','2026-06-19 13:19:40'),('080_home_content','2026-06-20 03:30:25'),('081_home_content_deeplink','2026-06-20 12:11:45'),('082_firstdep_tiers','2026-06-21 14:15:36'),('082_home_card_text','2026-06-20 14:13:18'),('083_wallet_banner_home_content','2026-06-21 15:31:58'),('084_review_config_scope','2026-06-22 13:12:08'),('085_kyc_badge_ignored','2026-06-22 14:21:02'),('086_drop_user_profile','2026-06-22 14:44:36'),('087_user_identity','2026-06-25 13:47:39'),('088_sms_daily_limit_setting','2026-06-26 13:18:43'),('089_sms_daily_ip_limit_setting','2026-06-26 13:27:42'),('090_otp_lock_seconds_setting','2026-06-26 13:36:20'),('091_kyc_failure_limits','2026-06-26 14:02:47'),('092_login_password_lock_settings','2026-06-26 14:38:23'),('093_admin_totp','2026-06-28 14:10:35'),('094_568win_integration','2026-07-02 00:17:41'),('095_568win_report_bets','2026-07-02 14:57:35'),('096_568win_key_auto_rotation','2026-07-02 15:37:05'),('097_568win_games','2026-07-02 15:49:02'),('098_568win_game_composite_key','2026-07-03 00:03:33'),('099_568win_game_override','2026-07-03 12:20:33'),('100_568win_game_comments','2026-07-03 12:58:43'),('101_568win_override_enrichment','2026-07-03 13:22:33'),('102_568win_txn_unique_fix','2026-07-03 13:48:30'),('103_568win_site_category','2026-07-03 14:33:47'),('104_568win_web_enrichment','2026-07-03 15:21:12'),('105_game_icon_dimensions','2026-07-04 05:44:07'),('105_gemini_search_quota','2026-07-04 09:28:03'),('106_image_override_source','2026-07-04 14:43:32'),('107_image_anim','2026-07-04 16:01:31'),('108_cover_candidate','2026-07-04 16:13:57'),('108_game_launch_history','2026-07-05 09:47:00'),('109_drop_ai_enrichment_fields','2026-07-05 10:22:50'),('109_homepage_section_game','2026-07-05 03:02:58'),('110_drop_sg_games','2026-07-05 10:59:20'),('111_review_rules_568win','2026-07-05 14:32:03'),('112_cs_escalation','2026-07-05 14:56:28'),('113_app_download_bonus','2026-07-05 14:56:30'),('114_team_review_rules','2026-07-06 00:18:12'),('115_remove_deprecated_crypto','2026-07-06 05:58:02'),('116_category_sort_game','2026-07-06 13:35:23'),('117_channel_deposit_bonus','2026-07-06 14:25:40'),('118_drop_channel_deposit_bonus','2026-07-06 15:55:26'),('119_login_device','2026-07-07 01:11:32'),('120_team_same_ip_device_param','2026-07-07 02:56:21'),('121_daily_checkin','2026-07-07 05:19:07'),('122_trial_turnover_3x','2026-07-07 12:22:09'),('123_user_segment','2026-07-07 12:56:29'),('124_spin_checkin_tab','2026-07-07 15:11:47'),('125_spin_checkin_tiers','2026-07-07 15:28:00'),('126_vip_growth','2026-07-08 06:48:03'),('127_vip_phase2','2026-07-08 07:50:43'),('128_task_system','2026-07-08 10:11:46'),('129_add_missing_comments','2026-07-08 14:41:48'),('130_user_entry_source','2026-07-09 05:45:13'),('131_risk_control','2026-07-10 04:02:32'),('132_drop_bind_telegram_task','2026-07-11 02:18:09'),('133_ledger_balance_after_decimal','2026-07-11 16:35:44'),('134_provider_normalize','2026-07-12 01:30:25'),('135_provider_weight','2026-07-12 02:58:01'),('136_redep_offer','2026-07-12 08:12:45'),('137_drop_slotegrator_aggregator','2026-07-12 13:19:22'),('138_loss_rebate','2026-07-12 14:09:32'),('139_promo_config_value_text','2026-07-12 14:42:07'),('140_568win_player_multicurrency','2026-07-13 10:34:41'),('141_multicurrency_vip_ledger','2026-07-13 12:42:53'),('142_task_claim_currency','2026-07-13 13:28:10'),('143_promo_multicurrency','2026-07-13 14:04:00'),('144_spin_multicurrency','2026-07-13 14:43:01'),('145_drop_unused_tables','2026-07-14 06:43:21'),('146_fix_usdt_vip_lv2_bonus','2026-07-14 11:55:31'),('147_cs_session_lifecycle','2026-07-15 02:13:53'),('148_virtual_game_config','2026-07-15 07:17:18'),('149_bet_round','2026-07-16 07:01:25'),('150_user_id_seq','2026-07-16 12:33:30'),('151_turnover_total_accumulator','2026-07-16 14:00:09'),('152_drop_account_identity','2026-07-17 05:43:38'),('153_normalize_kyc_id_no','2026-07-17 06:14:53'),('154_cs_agent_name','2026-07-17 07:03:58'),('155_community_marketing','2026-07-18 11:47:36'),('156_tg_broadcast','2026-07-19 14:03:10'),('157_bi_daily_tables','2026-07-20 07:15:47'),('158_bi_user_daily','2026-07-20 07:37:58'),('159_bi_daily_channel','2026-07-20 07:55:03'),('160_update_telegram_social_channel','2026-07-21 01:35:03'),('161_matrix_usdt_usdc_deposit_channels','2026-07-21 02:49:14'),('162_enable_matrix_usdc','2026-07-21 06:35:14'),('163_firstdep_tiers_adjust','2026-07-22 01:45:26'),('164_yfpay_limits_and_gotyme','2026-07-22 01:45:27'),('165_rename_virtual_sportsbook','2026-07-22 05:00:34'),('166_crypto_withdraw_limits','2026-07-23 03:40:11'),('167_crypto_withdraw_gas_fee','2026-07-23 04:02:37'),('168_crypto_gas_discount','2026-07-23 05:37:49'),('169_ad_attribution','2026-07-24 13:31:30'),('170_pending_install','2026-07-25 01:57:54'),('171_pending_install_key_index','2026-07-25 02:56:44'),('172_capi_pixel_token','2026-07-25 10:25:38'),('173_capi_test_event_code','2026-07-25 13:25:11'),('174_capi_promo_domain','2026-07-26 08:10:34'),('175_capi_channel_code','2026-07-26 09:13:00'),('176_ad_channel_price','2026-07-26 15:00:46'),('177_turnover_base_amount','2026-07-27 01:25:59'),('178_widen_report_bet_ref_no','2026-07-27 03:23:35'),('179_withdraw_user_reject_reason','2026-07-27 05:08:05'),('180_appdl_claim_device','2026-07-27 06:32:38'),('180_cs_ai_summary','2026-07-27 06:22:59'),('181_withdraw_deposit_ratio_rule','2026-07-27 10:15:54'),('182_promo_claim_whitelist','2026-07-27 10:52:54'),('183_review_thresholds_to_yuan','2026-07-27 11:11:55'),('184_login_platform','2026-07-27 13:17:58'),('185_announcement','2026-07-28 02:00:20'),('186_homepage_frozen_board','2026-07-28 07:23:18'),('187_withdraw_kyc_name_rules','2026-07-28 11:05:07'),('188_split_same_ip_device_review_rules','2026-07-28 12:33:26'),('189_withdraw_review_scoring','2026-07-28 13:14:04'),('190_feature_bonus_ratio_rule','2026-07-29 09:40:25'),('190_promo_device_dedup_policy','2026-07-28 15:30:00'),('191_bet_order_created_index','2026-08-01 08:44:29'),('192_homepage_section_visibility','2026-08-01 10:05:29'),('193_task_checkin_indexes','2026-08-01 15:20:18'),('194_same_name_review_rule','2026-08-02 12:04:55'),('195_withdraw_badge_ignored','2026-08-03 13:17:09'),('196_cs_ticket_read_marker','2026-08-03 13:47:23'),('197_cs_ticket_badge_ignored','2026-08-03 14:34:39'),('198_admin_report_indexes','2026-08-04 23:25:26'),('199_redep_tiers','2026-08-31 08:35:06'),('199_unispay_indonesia_channels','2026-08-28 08:02:24'),('200_regular_redep','2026-08-31 08:49:28'),('200_unispay_three_idr_methods','2026-08-28 08:25:05'),('201_home_content_localized_images','2026-08-29 04:52:58'),('202_seed_idr_promotion_values','2026-08-29 05:13:09'),('203_idr_market_defaults','2026-08-29 10:21:14'),('204_payment_callback_issues','2026-08-29 10:21:15'),('205_seed_indonesian_cs_knowledge','2026-08-29 10:21:16'),('206_align_idr_values_with_php','2026-08-29 10:24:09'),('207_team_market_timezone','2026-08-29 10:54:43'),('208_team_idr_wallet','2026-08-29 15:26:11'),('209_multicurrency_review_and_team_activation','2026-08-29 21:52:26'),('210_site_domain_mappings','2026-08-30 08:56:26'),('211_public_site_domains','2026-08-30 09:15:04'),('212_app_domain_groups','2026-08-30 10:02:27'),('213_backfill_task_spin_chances','2026-08-30 13:08:57'),('214_bi_market_targets_and_rate_snapshots','2026-08-31 01:06:27'),('215_backfill_ph_bi_active_history','2026-08-31 01:09:01'),('216_regular_redeposit_bonus','2026-08-31 01:36:17'),('217_regular_redeposit_per_tier_turnover','2026-08-31 13:41:23'),('218_payment_channel_client_visibility','2026-09-02 07:12:24');
/*!40000 ALTER TABLE `schema_migrations` ENABLE KEYS */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

