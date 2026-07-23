import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  BFF_PORT: z.coerce.number().default(3000),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  // ── 后台告警 Telegram 群(与面向用户的 TELEGRAM_BOT_TOKEN 相互独立)───────────────
  // 两者留空则静默禁用告警,不影响主流程
  ADMIN_TG_BOT_TOKEN: z.string().default(''),
  ADMIN_TG_CHAT_ID: z.string().default(''),
  // 运营日报专用群(留空则回退到 ADMIN_TG_CHAT_ID，与告警同群)
  BI_REPORT_CHAT_ID: z.string().default(''),
  // 告警消息里后台深链前缀
  ADMIN_WEB_URL: z.string().default('https://www.188facai.com/admin-panel'),
  // 告警消息环境标签(如 🧪[测试环境]),留空不加。多环境共用同一告警群时用于区分来源
  ADMIN_NOTIFY_ENV_LABEL: z.string().default(''),
  // MySQL 连接池大小。生产验收压测(5.8节)证明池 10 是 4C16G 上的吞吐软上限之一
  MYSQL_POOL_SIZE: z.coerce.number().default(10),
  // 多实例部署时,副实例设 true:跳过全部"只能跑一份"的定时任务
  // (洗码/负盈利/VIP日任务/支付快照/汇率刷新/社区营销/种子),内存缓存类任务(games cache 等)不受影响
  BFF_DISABLE_SINGLETON_JOBS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  BFF_DEV_SKIP_TELEGRAM_AUTH: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // 压测专用：设为 true 时旁路全局限流中间件（默认 false）。仅测试环境临时开启，压完必须关。
  BFF_DISABLE_RATE_LIMIT: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // 后台高权限角色是否强制绑定 Google Authenticator。生产保持 true，测试环境可关闭。
  BFF_ADMIN_TOTP_REQUIRED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  SESSION_TTL_SECONDS: z.coerce.number().default(86400),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  // 逗号分隔白名单：一份前端 bundle 部署多域名（测试 188facai + 生产 betogo），
  // redirect_uri 按运行时 origin 生成，后端只需放行这些可信回调地址
  GOOGLE_REDIRECT_URI: z
    .string()
    .default(
      'https://www.188facai.com/auth/google/callback,https://www.betogo.games/auth/google/callback',
    ),
  // Telegram 新版网页登录（OIDC）。client_id 即 bot_id，从 TELEGRAM_BOT_TOKEN 前缀推导，无需单独配置
  TELEGRAM_OIDC_CLIENT_SECRET: z.string().default(''),
  TELEGRAM_OIDC_REDIRECT_URI: z
    .string()
    .default('https://www.188facai.com/auth/telegram/callback'),
  AMMER_PAY_PROVIDER_TOKEN: z.string().default(''),
  AMMER_PAY_PHP_PER_STAR: z.coerce.number().positive().default(1.12),
  // 社区营销 AI 文案改写(Claude Haiku)。留空则跳过改写直接用模板原文
  ANTHROPIC_API_KEY: z.string().default(''),
  // 第三方汇率 API（freecurrencyapi.com，免费额度 5000 次/月）
  EXCHANGE_RATE_API_KEY: z.string().default(''),
  // CoinGecko API key（可选，无 key 也可用免费 demo tier，50 次/分）
  COINGECKO_API_KEY: z.string().default(''),
  // 手动兜底汇率（无 API key 或 API 故障时使用）
  EUR_TO_PHP_RATE: z.coerce.number().positive().default(62),
  USDT_TO_PHP_RATE: z.coerce.number().positive().default(58),
  TRX_TO_PHP_RATE: z.coerce.number().positive().default(10),
  YFPAY_USERNAME: z.string().default(''),
  YFPAY_API_KEY: z.string().default(''),
  YFPAY_NOTIFY_URL: z.string().default('https://www.188facai.com/api/v1/callback/yfpay'),
  // ── BeePay ──────────────────────────────────────────────────────────────────
  BEEPAY_BASE_URL: z.string().default(''),
  BEEPAY_MID_NO: z.string().default(''),
  BEEPAY_API_KEY: z.string().default(''),
  BEEPAY_NOTIFY_URL: z.string().default('https://www.188facai.com/api/v1/callback/beepay'),
  NACOS_SERVER_ADDR: z.string().default(''),
  NACOS_NAMESPACE: z.string().default('batogo'),
  NACOS_DATA_ID: z.string().default('bff-node'),
  NACOS_GROUP: z.string().default('DEFAULT_GROUP'),
  GEMINI_API_KEY: z.string().default(''),
  // Cloudflare Turnstile 人机验证密钥；留空则注册不要求验证码
  TURNSTILE_SECRET_KEY: z.string().default(''),
  // ── TeleSMS(特利信) 短信通道（KYC 手机验证用）────────────────────────────────
  TELESMS_BASE_URL: z.string().default('https://api2.santo.cc'),
  TELESMS_CPID: z.string().default(''),
  TELESMS_CPPWD: z.string().default(''),
  // 自定义发送者号码（可选，不清楚含义就留空）
  TELESMS_SENDER: z.string().default(''),
  // ── KYC ────────────────────────────────────────────────────────────────────
  // Gemini 证件/人脸自动放行的最低置信度（0~1）
  KYC_GEMINI_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.85),
  // 人脸与证件照相似度通过阈值（0~1）兜底；后台 kyc_face_match_threshold 可覆盖
  KYC_FACE_MATCH_MIN: z.coerce.number().min(0).max(1).default(0.75),
  // 每用户每日证件/人脸提交次数上限（各自独立计，防刷 Gemini 调用）
  KYC_VERIFY_MAX_PER_DAY: z.coerce.number().int().min(1).default(10),
  // KYC 证件图片本地兜底存储目录（未配置 S3 时使用）
  KYC_STORAGE_DIR: z.string().default('/root/workspace/tma-projects/data/kyc'),
  // S3（预留，配置后切换；留空则用本地兜底）
  S3_BUCKET: z.string().default(''),
  S3_REGION: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_ENDPOINT: z.string().default(''),
  S3_PUBLIC_BASE_URL: z.string().default(''),
  IMAGE_CDN_BASE: z.string().default(''),
  // 通过 setWebhook ?secret_token= 设置后，Telegram 会在回调 header 中携带此值
  // 空字符串表示跳过验签（向下兼容，建议生产环境设置）
  TELEGRAM_WEBHOOK_SECRET: z.string().default(''),
  INTERNAL_TOKEN: z.string().default(''),
  CORE_NODE_URL: z.string().default('http://core-node:4000'),
  CS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // ── Matrix 加密支付通道 ─────────────────────────────────────────────────────
  // 网关地址，例如 https://gateway.example.com/api
  MATRIX_GATEWAY_URL: z.string().default(''),
  // 平台分配的商户 API Key
  MATRIX_API_KEY: z.string().default(''),
  // 商户 API 私钥（PEM 格式，\n 替换为实际换行）
  MATRIX_MERCHANT_API_PRIVATE_KEY: z.string().default(''),
  // 平台 API 公钥（PEM 格式，API_SIGN 类型）
  MATRIX_PLATFORM_API_PUBLIC_KEY: z.string().default(''),
  // 商户通知私钥（PEM 格式，NOTIFY_ENCRYPT 类型）
  MATRIX_MERCHANT_NOTIFY_PRIVATE_KEY: z.string().default(''),
  // 平台通知公钥（PEM 格式，NOTIFY_ENCRYPT 类型）
  MATRIX_PLATFORM_NOTIFY_PUBLIC_KEY: z.string().default(''),
  // 接收平台通知的公网地址，例如 https://api.yourdomain.com/api/v1/callback/matrix
  MATRIX_NOTIFY_URL: z.string().default(''),
  // 提现反查地址（可选）
  MATRIX_WITHDRAW_CHECK_URL: z.string().default(''),
})

export type Env = z.infer<typeof schema>

export function loadEnv(): Env {
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid environment: ${msg}`)
  }
  return parsed.data
}
