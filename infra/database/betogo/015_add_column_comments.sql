-- 015: 补充各表字段 COMMENT（纯元数据，无业务逻辑变更）
SET NAMES utf8mb4;

-- ── bg_user ───────────────────────────────────────────────────────────────────
ALTER TABLE `bg_user`
  MODIFY COLUMN `email`             VARCHAR(255) NULL                                                COMMENT '用户邮箱',
  MODIFY COLUMN `display_name`      VARCHAR(128) NOT NULL DEFAULT ''                                 COMMENT '昵称/展示名',
  MODIFY COLUMN `avatar_url`        VARCHAR(512) NULL                                                COMMENT '头像地址',
  MODIFY COLUMN `telegram_username` VARCHAR(128) NULL                                                COMMENT 'Telegram 用户名（@handle）',
  MODIFY COLUMN `status`            ENUM('active','frozen','banned') NOT NULL DEFAULT 'active'       COMMENT '账号状态',
  MODIFY COLUMN `status_reason`     VARCHAR(255) NULL                                                COMMENT '状态变更原因',
  MODIFY COLUMN `label`             VARCHAR(32)  NOT NULL DEFAULT 'normal'                           COMMENT '用户标签: normal | arbitrage',
  MODIFY COLUMN `registered_at`     DATETIME(3)  NOT NULL                                            COMMENT '注册时间',
  MODIFY COLUMN `last_login_at`     DATETIME(3)  NULL                                                COMMENT '最后登录时间',
  MODIFY COLUMN `last_login_ip`     VARCHAR(64)  NULL                                                COMMENT '最后登录 IP',
  MODIFY COLUMN `last_login_region` VARCHAR(128) NULL                                                COMMENT '最后登录地区',
  MODIFY COLUMN `register_ip`       VARCHAR(64)  NULL                                                COMMENT '注册 IP',
  MODIFY COLUMN `register_region`   VARCHAR(128) NULL                                                COMMENT '注册地区',
  MODIFY COLUMN `created_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)               COMMENT '记录创建时间',
  MODIFY COLUMN `updated_at`        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '记录更新时间';

-- ── bg_user_profile ───────────────────────────────────────────────────────────
ALTER TABLE `bg_user_profile`
  MODIFY COLUMN `user_id`    VARCHAR(32) NOT NULL                                                    COMMENT '关联 bg_user.id',
  MODIFY COLUMN `first_name` VARCHAR(64) NOT NULL DEFAULT ''                                         COMMENT '名',
  MODIFY COLUMN `last_name`  VARCHAR(64) NOT NULL DEFAULT ''                                         COMMENT '姓',
  MODIFY COLUMN `gender`     ENUM('','male','female','other') NOT NULL DEFAULT ''                    COMMENT '性别',
  MODIFY COLUMN `dob_month`  CHAR(2)     NOT NULL DEFAULT ''                                         COMMENT '出生月（01-12）',
  MODIFY COLUMN `dob_day`    CHAR(2)     NOT NULL DEFAULT ''                                         COMMENT '出生日（01-31）',
  MODIFY COLUMN `dob_year`   CHAR(4)     NOT NULL DEFAULT ''                                         COMMENT '出生年（如 1990）',
  MODIFY COLUMN `phone`      VARCHAR(32) NULL                                                        COMMENT '手机号',
  MODIFY COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)                       COMMENT '记录创建时间',
  MODIFY COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '记录更新时间';

-- ── bg_user_promo_state ───────────────────────────────────────────────────────
ALTER TABLE `bg_user_promo_state`
  MODIFY COLUMN `user_id`           VARCHAR(32) NOT NULL                                             COMMENT '关联 bg_user.id',
  MODIFY COLUMN `trial_claimed`     TINYINT(1)  NOT NULL DEFAULT 0                                   COMMENT '体验金已领取',
  MODIFY COLUMN `referral_claimed`  TINYINT(1)  NOT NULL DEFAULT 0                                   COMMENT '邀请奖励已领取',
  MODIFY COLUMN `first_dep_claimed` TINYINT(1)  NOT NULL DEFAULT 0                                   COMMENT '首充奖励已领取',
  MODIFY COLUMN `first_dep_ready`   TINYINT(1)  NOT NULL DEFAULT 0                                   COMMENT '首充奖励待领取',
  MODIFY COLUMN `updated_at`        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '记录更新时间';

-- ── bg_session ────────────────────────────────────────────────────────────────
ALTER TABLE `bg_session`
  MODIFY COLUMN `token`      CHAR(64)    NOT NULL                                                    COMMENT '会话令牌（随机 hex）',
  MODIFY COLUMN `user_id`    VARCHAR(32) NOT NULL                                                    COMMENT '关联 bg_user.id',
  MODIFY COLUMN `expires_at` DATETIME(3) NOT NULL                                                    COMMENT '过期时间',
  MODIFY COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)                       COMMENT '创建时间';

-- ── bg_wallet ─────────────────────────────────────────────────────────────────
ALTER TABLE `bg_wallet`
  MODIFY COLUMN `user_id`    VARCHAR(32) NOT NULL                                                    COMMENT '关联 bg_user.id',
  MODIFY COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '最后变动时间';

-- ── bg_wallet_ledger ──────────────────────────────────────────────────────────
-- amount、balance_after 由 016 迁移处理（类型/列名变更），此处只补其余字段
ALTER TABLE `bg_wallet_ledger`
  MODIFY COLUMN `user_id`     VARCHAR(32)  NOT NULL                              COMMENT '关联 bg_user.id',
  MODIFY COLUMN `type`        ENUM('deposit','withdraw','bet','win','red_packet','bonus','adjust','admin_adjust') NOT NULL COMMENT '账变类型',
  MODIFY COLUMN `ref_id`      VARCHAR(64)  NULL                                  COMMENT '关联单号，如 order_id / round_id',
  MODIFY COLUMN `description` VARCHAR(255) NOT NULL DEFAULT ''                   COMMENT '账变描述',
  MODIFY COLUMN `trace_id`    VARCHAR(64)  NULL                                  COMMENT '请求链路 ID',
  MODIFY COLUMN `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间';

-- ── bg_order_deposit ──────────────────────────────────────────────────────────
ALTER TABLE `bg_order_deposit`
  MODIFY COLUMN `order_id`      VARCHAR(64)    NOT NULL                                              COMMENT '存款订单号',
  MODIFY COLUMN `user_id`       VARCHAR(32)    NOT NULL                                              COMMENT '关联 bg_user.id',
  MODIFY COLUMN `currency`      VARCHAR(10)    NOT NULL DEFAULT 'PHP'                                COMMENT '支付币种',
  MODIFY COLUMN `channel_id`    VARCHAR(32)    NOT NULL DEFAULT 'tg_wallet'                          COMMENT '支付渠道标识',
  MODIFY COLUMN `status`        VARCHAR(20)    NOT NULL DEFAULT 'pending'                            COMMENT 'pending | paid | failed | cancelled',
  MODIFY COLUMN `provider`      VARCHAR(32)    DEFAULT NULL                                          COMMENT '支付服务商，如 yfpay',
  MODIFY COLUMN `paid_at`       DATETIME(3)    DEFAULT NULL                                          COMMENT '支付成功时间',
  MODIFY COLUMN `created_at`    DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3)                 COMMENT '下单时间',
  MODIFY COLUMN `updated_at`    DATETIME(3)    NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间';

-- ── bg_order_withdraw ─────────────────────────────────────────────────────────
ALTER TABLE `bg_order_withdraw`
  MODIFY COLUMN `order_id`      VARCHAR(64)  NOT NULL                                                COMMENT '提款订单号',
  MODIFY COLUMN `user_id`       VARCHAR(32)  NOT NULL                                                COMMENT '关联 bg_user.id',
  MODIFY COLUMN `amount`        DECIMAL(18,4) NOT NULL                                               COMMENT '提款金额（PHP 元）',
  MODIFY COLUMN `currency`      CHAR(3)      NOT NULL DEFAULT 'PHP'                                  COMMENT '币种',
  MODIFY COLUMN `channel_id`    VARCHAR(32)  NOT NULL DEFAULT 'tg_wallet'                            COMMENT '提款渠道标识',
  MODIFY COLUMN `status`        VARCHAR(20)  NOT NULL DEFAULT 'pending'                              COMMENT 'pending | processing | completed | rejected | failed',
  MODIFY COLUMN `provider`      VARCHAR(32)  DEFAULT NULL                                            COMMENT '出款服务商',
  MODIFY COLUMN `provider_ref`  VARCHAR(128) DEFAULT NULL                                            COMMENT '服务商单号',
  MODIFY COLUMN `extra_data`    JSON         DEFAULT NULL                                            COMMENT '渠道专有数据',
  MODIFY COLUMN `reject_reason` VARCHAR(255) DEFAULT NULL                                            COMMENT '拒绝原因',
  MODIFY COLUMN `completed_at`  DATETIME(3)  DEFAULT NULL                                            COMMENT '完成时间',
  MODIFY COLUMN `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)                   COMMENT '申请时间',
  MODIFY COLUMN `updated_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间';

-- ── bg_kyc_submission ─────────────────────────────────────────────────────────
ALTER TABLE `bg_kyc_submission`
  MODIFY COLUMN `submission_id` VARCHAR(40)  NOT NULL                                                COMMENT 'KYC 提交单号',
  MODIFY COLUMN `user_id`       VARCHAR(32)  NOT NULL                                                COMMENT '关联 bg_user.id',
  MODIFY COLUMN `status`        ENUM('none','pending','approved','rejected') NOT NULL DEFAULT 'pending' COMMENT '审核状态',
  MODIFY COLUMN `full_name`     VARCHAR(128) NOT NULL DEFAULT ''                                     COMMENT '证件全名',
  MODIFY COLUMN `gender`        VARCHAR(16)  NOT NULL DEFAULT ''                                     COMMENT '性别',
  MODIFY COLUMN `dob`           DATE         NULL                                                    COMMENT '出生日期',
  MODIFY COLUMN `doc_type`      VARCHAR(32)  NULL                                                    COMMENT '证件类型，如 passport | driver_license',
  MODIFY COLUMN `file_ids`      JSON         NULL                                                    COMMENT '上传文件 ID 列表',
  MODIFY COLUMN `reject_reason` VARCHAR(255) NULL                                                    COMMENT '拒绝原因',
  MODIFY COLUMN `submitted_at`  DATETIME(3)  NOT NULL                                                COMMENT '提交时间',
  MODIFY COLUMN `reviewed_at`   DATETIME(3)  NULL                                                    COMMENT '审核时间';

-- ── bg_promo_claim ────────────────────────────────────────────────────────────
ALTER TABLE `bg_promo_claim`
  MODIFY COLUMN `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT                                  COMMENT '自增主键',
  MODIFY COLUMN `user_id`    VARCHAR(32) NOT NULL                                                    COMMENT '关联 bg_user.id',
  MODIFY COLUMN `claimed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)                       COMMENT '领取时间';

-- ── bg_referral_record ────────────────────────────────────────────────────────
-- reward_cents 由 016 迁移重命名，此处不修改
ALTER TABLE `bg_referral_record`
  MODIFY COLUMN `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT  COMMENT '自增主键',
  MODIFY COLUMN `inviter_id` VARCHAR(32) NOT NULL                     COMMENT '邀请人 bg_user.id',
  MODIFY COLUMN `invitee_id` VARCHAR(32) NOT NULL                     COMMENT '被邀请人 bg_user.id',
  MODIFY COLUMN `role`       ENUM('inviter','invitee') NOT NULL        COMMENT '本行角色',
  MODIFY COLUMN `status`     VARCHAR(32) NOT NULL DEFAULT 'pending'   COMMENT 'pending | qualified | rewarded',
  MODIFY COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间';

-- ── bg_bet_order ──────────────────────────────────────────────────────────────
-- amount_cents 由 016 迁移重命名，此处不修改
ALTER TABLE `bg_bet_order`
  MODIFY COLUMN `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT    COMMENT '自增主键',
  MODIFY COLUMN `user_id`         VARCHAR(32)  NOT NULL                      COMMENT '关联 bg_user.id',
  MODIFY COLUMN `aggregator_id`   VARCHAR(32)  NOT NULL                      COMMENT '聚合商标识，如 slotegrator',
  MODIFY COLUMN `provider_id`     VARCHAR(64)  NOT NULL                      COMMENT '游戏 UUID / 供应商游戏 ID',
  MODIFY COLUMN `round_id`        VARCHAR(128) NULL                          COMMENT '游戏局号',
  MODIFY COLUMN `bet_type`        ENUM('bet','win','refund','cancel') NOT NULL COMMENT '账变类型',
  MODIFY COLUMN `currency_code`   CHAR(3)      NOT NULL DEFAULT 'PHP'        COMMENT '原始投注币种',
  MODIFY COLUMN `original_amount` DECIMAL(18,4) NULL                         COMMENT '原始投注金额（原币）',
  MODIFY COLUMN `exchange_rate`   DECIMAL(18,8) NULL                         COMMENT '入账时汇率（原币→PHP）',
  MODIFY COLUMN `status`          ENUM('pending','settled','failed') NOT NULL DEFAULT 'pending' COMMENT '结算状态',
  MODIFY COLUMN `trace_id`        VARCHAR(64)  NULL                          COMMENT '请求链路 ID',
  MODIFY COLUMN `created_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '投注时间',
  MODIFY COLUMN `settled_at`      DATETIME(3)  NULL                          COMMENT '结算时间';

-- ── bg_game_session ───────────────────────────────────────────────────────────
ALTER TABLE `bg_game_session`
  MODIFY COLUMN `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT                                COMMENT '自增主键',
  MODIFY COLUMN `user_id`     VARCHAR(32) NOT NULL                                                   COMMENT '关联 bg_user.id',
  MODIFY COLUMN `game_id`     VARCHAR(64) NOT NULL                                                   COMMENT '游戏 UUID',
  MODIFY COLUMN `provider_id` VARCHAR(64) NOT NULL                                                   COMMENT '供应商标识',
  MODIFY COLUMN `status`      ENUM('active','closed') NOT NULL DEFAULT 'active'                      COMMENT '会话状态',
  MODIFY COLUMN `device_id`   VARCHAR(64) NULL                                                       COMMENT '设备标识',
  MODIFY COLUMN `started_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)                      COMMENT '开始时间',
  MODIFY COLUMN `ended_at`    DATETIME(3) NULL                                                       COMMENT '结束时间';

-- ── bg_idempotency ────────────────────────────────────────────────────────────
ALTER TABLE `bg_idempotency`
  MODIFY COLUMN `idempotency_key` VARCHAR(191) NOT NULL                                              COMMENT '幂等键（transaction_id 等）',
  MODIFY COLUMN `created_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)                 COMMENT '首次处理时间',
  MODIFY COLUMN `expires_at`      DATETIME(3)  NOT NULL                                              COMMENT '幂等记录过期时间';

-- ── sg_games ──────────────────────────────────────────────────────────────────
ALTER TABLE `sg_games`
  MODIFY COLUMN `name`         VARCHAR(255) NOT NULL                                                 COMMENT '游戏名称',
  MODIFY COLUMN `category`     VARCHAR(64)  NULL                                                     COMMENT '主分类，如 slots | live',
  MODIFY COLUMN `sub_category` VARCHAR(64)  NULL                                                     COMMENT '子分类',
  MODIFY COLUMN `image_url`    VARCHAR(512) NULL                                                     COMMENT '封面图地址',
  MODIFY COLUMN `has_demo`     TINYINT(1)   NOT NULL DEFAULT 1                                       COMMENT '是否支持试玩',
  MODIFY COLUMN `has_lobby`    TINYINT(1)   NOT NULL DEFAULT 0                                       COMMENT '是否有大厅入口',
  MODIFY COLUMN `is_mobile`    TINYINT(1)   NOT NULL DEFAULT 1                                       COMMENT '是否支持移动端',
  MODIFY COLUMN `is_active`    TINYINT(1)   NOT NULL DEFAULT 1                                       COMMENT '是否在平台上架',
  MODIFY COLUMN `tags`         JSON         NULL                                                     COMMENT '标签列表',
  MODIFY COLUMN `features`     JSON         NULL                                                     COMMENT '特性列表，如 bonus_buy',
  MODIFY COLUMN `updated_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '最后同步时间';

-- ── admin_accounts ────────────────────────────────────────────────────────────
ALTER TABLE `admin_accounts`
  MODIFY COLUMN `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT                                  COMMENT '自增主键',
  MODIFY COLUMN `username`      VARCHAR(64)  NOT NULL                                                COMMENT '登录账号',
  MODIFY COLUMN `role`          ENUM('super_admin','finance','ops','support') NOT NULL DEFAULT 'support' COMMENT '角色权限',
  MODIFY COLUMN `status`        ENUM('active','disabled') NOT NULL DEFAULT 'active'                  COMMENT '账号状态',
  MODIFY COLUMN `last_login_at` DATETIME(3)  NULL                                                    COMMENT '最后登录时间',
  MODIFY COLUMN `created_at`    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)                   COMMENT '创建时间';

-- ── admin_audit_log ───────────────────────────────────────────────────────────
ALTER TABLE `admin_audit_log`
  MODIFY COLUMN `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT                             COMMENT '自增主键',
  MODIFY COLUMN `admin_id`       INT UNSIGNED    NOT NULL                                            COMMENT '操作管理员 ID',
  MODIFY COLUMN `admin_username` VARCHAR(64)     NOT NULL                                            COMMENT '操作管理员账号',
  MODIFY COLUMN `action`         VARCHAR(128)    NOT NULL                                            COMMENT '操作类型，如 user.status_change',
  MODIFY COLUMN `target_type`    VARCHAR(64)     NULL                                                COMMENT '操作对象类型，如 user | order',
  MODIFY COLUMN `target_id`      VARCHAR(128)    NULL                                                COMMENT '操作对象 ID',
  MODIFY COLUMN `detail`         JSON            NULL                                                COMMENT '操作详情快照',
  MODIFY COLUMN `ip`             VARCHAR(64)     NULL                                                COMMENT '操作来源 IP',
  MODIFY COLUMN `created_at`     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3)               COMMENT '操作时间';

-- ── bg_login_log ──────────────────────────────────────────────────────────────
ALTER TABLE `bg_login_log`
  MODIFY COLUMN `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT                                COMMENT '自增主键',
  MODIFY COLUMN `user_id`     VARCHAR(32)  NOT NULL                                                  COMMENT '关联 bg_user.id',
  MODIFY COLUMN `ip`          VARCHAR(64)  NULL                                                      COMMENT '登录 IP',
  MODIFY COLUMN `region`      VARCHAR(128) NULL                                                      COMMENT '登录地区（国家/城市）',
  MODIFY COLUMN `user_agent`  VARCHAR(512) NULL                                                      COMMENT '浏览器 UA',
  MODIFY COLUMN `auth_method` VARCHAR(32)  NOT NULL DEFAULT 'telegram'                               COMMENT '登录方式: telegram | google',
  MODIFY COLUMN `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)                     COMMENT '登录时间';

-- ── bg_admin_settings ─────────────────────────────────────────────────────────
ALTER TABLE `bg_admin_settings`
  MODIFY COLUMN `key`        VARCHAR(64) NOT NULL                                                    COMMENT '配置键，如 op_password',
  MODIFY COLUMN `value`      TEXT        NOT NULL                                                    COMMENT '配置值（可为 JSON 字符串）',
  MODIFY COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间';

-- ── bg_exchange_rate ──────────────────────────────────────────────────────────
ALTER TABLE `bg_exchange_rate`
  MODIFY COLUMN `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT                                 COMMENT '自增主键',
  MODIFY COLUMN `source`     VARCHAR(64)     NOT NULL DEFAULT 'exchangerate-api'                     COMMENT '汇率来源，如 exchangerate-api | coingecko',
  MODIFY COLUMN `fetched_at` DATETIME(3)     NOT NULL                                                COMMENT '抓取时间';

-- ── sg_settlement_report ──────────────────────────────────────────────────────
ALTER TABLE `sg_settlement_report`
  MODIFY COLUMN `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT                             COMMENT '自增主键',
  MODIFY COLUMN `sg_round_count` INT UNSIGNED    NOT NULL DEFAULT 0                                  COMMENT 'SG 报告局数',
  MODIFY COLUMN `fetched_at`     DATETIME(3)     NOT NULL                                            COMMENT '报告拉取时间',
  MODIFY COLUMN `reconciled`     TINYINT(1)      NOT NULL DEFAULT 0                                  COMMENT '是否已核对（0=待核，1=已核）';

-- ── cs_conversation ───────────────────────────────────────────────────────────
ALTER TABLE `cs_conversation`
  MODIFY COLUMN `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT                          COMMENT '自增主键',
  MODIFY COLUMN `user_id`           VARCHAR(20)     NOT NULL                                         COMMENT '关联 bg_user.id',
  MODIFY COLUMN `status`            ENUM('active','human_taken','resolved','closed') NOT NULL DEFAULT 'active' COMMENT '会话状态',
  MODIFY COLUMN `assigned_admin_id` INT UNSIGNED    NULL                                             COMMENT '接管的管理员 ID',
  MODIFY COLUMN `created_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP               COMMENT '创建时间',
  MODIFY COLUMN `updated_at`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  MODIFY COLUMN `resolved_at`       DATETIME        NULL                                             COMMENT '解决时间';

-- ── cs_message ────────────────────────────────────────────────────────────────
ALTER TABLE `cs_message`
  MODIFY COLUMN `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT                            COMMENT '自增主键',
  MODIFY COLUMN `conversation_id` BIGINT UNSIGNED NOT NULL                                           COMMENT '关联 cs_conversation.id',
  MODIFY COLUMN `role`            ENUM('user','assistant','admin') NOT NULL                          COMMENT '消息来源: user | assistant | admin',
  MODIFY COLUMN `content`         TEXT            NOT NULL                                           COMMENT '消息内容',
  MODIFY COLUMN `created_at`      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP                 COMMENT '发送时间';

-- ── cs_faq ────────────────────────────────────────────────────────────────────
ALTER TABLE `cs_faq`
  MODIFY COLUMN `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT                                    COMMENT '自增主键',
  MODIFY COLUMN `category`   VARCHAR(64)  NOT NULL                                                   COMMENT 'FAQ 分类，如 deposit | withdraw | account',
  MODIFY COLUMN `question`   VARCHAR(512) NOT NULL                                                   COMMENT '问题',
  MODIFY COLUMN `answer`     TEXT         NOT NULL                                                   COMMENT '答案',
  MODIFY COLUMN `lang`       VARCHAR(8)   NOT NULL DEFAULT 'zh'                                      COMMENT '语言代码，如 zh | en',
  MODIFY COLUMN `sort_order` INT          NOT NULL DEFAULT 0                                         COMMENT '同分类内排序权重（越小越靠前）',
  MODIFY COLUMN `is_active`  TINYINT(1)   NOT NULL DEFAULT 1                                         COMMENT '是否启用',
  MODIFY COLUMN `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP                         COMMENT '创建时间',
  MODIFY COLUMN `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间';
