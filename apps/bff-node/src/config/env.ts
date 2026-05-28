import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
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
  AMMER_PAY_PROVIDER_TOKEN: z.string().default(''),
  AMMER_PAY_PHP_PER_STAR: z.coerce.number().positive().default(1.12),
  USDT_TO_PHP_RATE: z.coerce.number().positive().default(58),
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
  SG_RETURN_URL: z.string().default('https://www.188facai.com'),
  NACOS_SERVER_ADDR: z.string().default(''),
  NACOS_NAMESPACE: z.string().default('batogo'),
  NACOS_DATA_ID: z.string().default('bff-node'),
  NACOS_GROUP: z.string().default('DEFAULT_GROUP'),
  GEMINI_API_KEY: z.string().default(''),
  // 通过 setWebhook ?secret_token= 设置后，Telegram 会在回调 header 中携带此值
  // 空字符串表示跳过验签（向下兼容，建议生产环境设置）
  TELEGRAM_WEBHOOK_SECRET: z.string().default(''),
  CS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
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
