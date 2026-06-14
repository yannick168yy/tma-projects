import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  BFF_PORT: z.coerce.number().default(3000),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  BFF_DEV_SKIP_TELEGRAM_AUTH: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SESSION_TTL_SECONDS: z.coerce.number().default(86400),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REDIRECT_URI: z
    .string()
    .default('https://www.188facai.com/auth/google/callback'),
  // Telegram 新版网页登录（OIDC）。client_id 即 bot_id，从 TELEGRAM_BOT_TOKEN 前缀推导，无需单独配置
  TELEGRAM_OIDC_CLIENT_SECRET: z.string().default(''),
  TELEGRAM_OIDC_REDIRECT_URI: z
    .string()
    .default('https://www.188facai.com/auth/telegram/callback'),
  AMMER_PAY_PROVIDER_TOKEN: z.string().default(''),
  AMMER_PAY_PHP_PER_STAR: z.coerce.number().positive().default(1.12),
  // 第三方汇率 API（freecurrencyapi.com，免费额度 5000 次/月）
  EXCHANGE_RATE_API_KEY: z.string().default(''),
  // CoinGecko API key（可选，无 key 也可用免费 demo tier，50 次/分）
  COINGECKO_API_KEY: z.string().default(''),
  // 手动兜底汇率（无 API key 或 API 故障时使用）
  EUR_TO_PHP_RATE: z.coerce.number().positive().default(62),
  USDT_TO_PHP_RATE: z.coerce.number().positive().default(58),
  TRX_TO_PHP_RATE: z.coerce.number().positive().default(10),
  BNB_TO_PHP_RATE: z.coerce.number().positive().default(33000),
  ETH_TO_PHP_RATE: z.coerce.number().positive().default(145000),
  BTC_TO_PHP_RATE: z.coerce.number().positive().default(5800000),
  YFPAY_USERNAME: z.string().default(''),
  YFPAY_API_KEY: z.string().default(''),
  YFPAY_NOTIFY_URL: z.string().default('https://www.188facai.com/api/v1/callback/yfpay'),
  MERCHANT_TON_ADDRESS: z.string().default('UQBjAz1W6jUkH7WJbxwu7rSHbJaOg65TVFHv8w6b1Nx697rJ'),
  TON_TO_PHP_RATE: z.coerce.number().positive().default(350),
  TONCENTER_API_KEY: z.string().default(''),
  SG_BASE_URL: z.string().default(''),
  SG_MERCHANT_ID: z.string().default(''),
  SG_MERCHANT_KEY: z.string().default(''),
  SG_CURRENCY: z.string().default('EUR'),
  SG_MULTI_CURRENCY: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  SG_RETURN_URL: z.string().default('https://www.188facai.com'),
  NACOS_SERVER_ADDR: z.string().default(''),
  NACOS_NAMESPACE: z.string().default('batogo'),
  NACOS_DATA_ID: z.string().default('bff-node'),
  NACOS_GROUP: z.string().default('DEFAULT_GROUP'),
  GEMINI_API_KEY: z.string().default(''),
  // ── TeleSMS(特利信) 短信通道（KYC 手机验证用）────────────────────────────────
  TELESMS_BASE_URL: z.string().default('https://api2.santo.cc'),
  TELESMS_CPID: z.string().default(''),
  TELESMS_CPPWD: z.string().default(''),
  // 自定义发送者号码（可选，不清楚含义就留空）
  TELESMS_SENDER: z.string().default(''),
  // ── KYC ────────────────────────────────────────────────────────────────────
  // Gemini 证件/人脸自动放行的最低置信度（0~1）
  KYC_GEMINI_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.85),
  // KYC 证件图片本地兜底存储目录（未配置 S3 时使用）
  KYC_STORAGE_DIR: z.string().default('/root/workspace/tma-projects/data/kyc'),
  // S3（预留，配置后切换；留空则用本地兜底）
  S3_BUCKET: z.string().default(''),
  S3_REGION: z.string().default(''),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_ENDPOINT: z.string().default(''),
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
