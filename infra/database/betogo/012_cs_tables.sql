-- 012: AI 客服表（会话 / 消息 / FAQ 知识库）— 全部幂等

CREATE TABLE IF NOT EXISTS `cs_conversation` (
  `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`           BIGINT UNSIGNED NOT NULL,
  `status`            ENUM('active','human_taken','resolved','closed') NOT NULL DEFAULT 'active',
  `assigned_admin_id` INT UNSIGNED NULL,
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `resolved_at`       DATETIME NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_user_id`   (`user_id`),
  INDEX `idx_status`    (`status`),
  INDEX `idx_updated_at`(`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cs_message` (
  `id`              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `conversation_id` BIGINT UNSIGNED NOT NULL,
  `role`            ENUM('user','assistant','admin') NOT NULL,
  `content`         TEXT NOT NULL,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_conversation_id` (`conversation_id`),
  INDEX `idx_created_at`      (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cs_faq` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category`   VARCHAR(64)  NOT NULL,
  `question`   VARCHAR(512) NOT NULL,
  `answer`     TEXT         NOT NULL,
  `lang`       VARCHAR(8)   NOT NULL DEFAULT 'zh',
  `sort_order` INT          NOT NULL DEFAULT 0,
  `is_active`  TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_category` (`category`, `lang`),
  INDEX `idx_active`   (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 初始 FAQ 数据
INSERT IGNORE INTO `cs_faq` (`id`, `category`, `question`, `answer`, `lang`, `sort_order`) VALUES
(1,  'deposit',    '如何充值？', '您可以通过钱包页面选择 GCash、Maya 或 USDT 方式充值。点击"充值"按钮，选择金额和支付方式，按照提示完成支付即可。充值通常在 5-15 分钟内到账。', 'zh', 1),
(2,  'deposit',    '充值多久到账？', '一般支付后 5-15 分钟内自动到账。高峰时段可能延迟至 30 分钟。如超过 1 小时未到账，请联系客服并提供您的充值截图。', 'zh', 2),
(3,  'deposit',    '充值最低金额是多少？', '最低充值金额为 ₱100。', 'zh', 3),
(4,  'withdraw',   '如何提款？', '在钱包页面点击"提款"，填写您的 GCash/Maya 账号及金额，提交后等待审核。审核通过后资金将在 1-24 小时内到账。', 'zh', 1),
(5,  'withdraw',   '提款需要多久？', '提款申请通常在 1-24 小时内处理。工作日审核更快，节假日可能延迟。', 'zh', 2),
(6,  'withdraw',   '提款最低金额是多少？', '最低提款金额为 ₱200。', 'zh', 3),
(7,  'account',    '忘记密码怎么办？', '目前账号通过 Telegram 登录，无需密码。如果无法登录，请确认您使用的是正确的 Telegram 账号。', 'zh', 1),
(8,  'account',    '账号被冻结怎么办？', '账号冻结通常是由于违反平台规则或安全原因。请联系客服说明情况，我们会在 24 小时内处理。', 'zh', 2),
(9,  'kyc',        'KYC 认证需要什么材料？', '需要提交有效的政府颁发身份证件（护照或驾照）的正反面照片，以及一张手持证件的自拍照。', 'zh', 1),
(10, 'kyc',        'KYC 认证需要多久？', '一般 1-3 个工作日完成审核。提交后请耐心等待，我们会通过消息通知您结果。', 'zh', 2),
(11, 'game',       '游戏出现问题怎么办？', '如果游戏加载失败，请尝试刷新页面或重新进入。如果游戏中途断线导致投注结算有误，请截图保存并联系客服。', 'zh', 1),
(12, 'bonus',      '如何领取奖金？', '奖金活动会在活动页面显示。新用户注册奖金会自动发放，其他活动奖金需在活动页面手动领取。', 'zh', 1);
