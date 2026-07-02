import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORE_PORT: z.coerce.number().default(4000),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  MYSQL_HOST: z.string().default('localhost'),
  MYSQL_PORT: z.coerce.number().default(3306),
  MYSQL_DATABASE: z.string().default('betogo'),
  MYSQL_USER: z.string().default('betogo'),
  MYSQL_PASSWORD: z.string().default(''),

  NATS_URL: z.string().default('nats://localhost:4222'),
  NATS_STREAM: z.string().default('BETOGO'),
  NATS_LEDGER_SUBJECT: z.string().default('betogo.ledger'),
  NATS_CALLBACK_SUBJECT: z.string().default('betogo.callback'),

  // SG 回调处理
  SG_MERCHANT_ID: z.string().default(''),
  SG_MERCHANT_KEY: z.string().default(''),
  SG_CURRENCY: z.string().default('EUR'),
  // 多货币模式：true = 按回调 currency 字段区分账户；false = 全部视为 SG_CURRENCY
  SG_MULTI_CURRENCY: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),

  // 568Win 聚合商
  WIN568_BASE_URL: z.string().default('https://test-api.568win.com'),
  WIN568_COMPANY_KEY: z.string().default(''),
  WIN568_SERVER_ID: z.string().default(''),
  WIN568_SW_COMPANY_KEY: z.string().default(''),
  WIN568_SW_ALLOWED_IPS: z.string().default(''),
  WIN568_DEFAULT_CURRENCY: z.enum(['PHP', 'USDT']).default('PHP'),

  // YFPay 回调验签
  YFPAY_API_KEY: z.string().default(''),

  // BeePay 回调验签
  BEEPAY_API_KEY: z.string().default(''),

  // Matrix 通知密钥（入站验签解密）
  MATRIX_MERCHANT_NOTIFY_PRIVATE_KEY: z.string().default(''),
  MATRIX_PLATFORM_NOTIFY_PUBLIC_KEY: z.string().default(''),

  // 汇率兜底（CoinGecko 不可用时使用，单位：PHP）
  USDT_TO_PHP_RATE: z.coerce.number().positive().default(58),
  EUR_TO_PHP_RATE:  z.coerce.number().positive().default(62),
  TRX_TO_PHP_RATE:  z.coerce.number().positive().default(19),
  BNB_TO_PHP_RATE:  z.coerce.number().positive().default(33000),
  ETH_TO_PHP_RATE:  z.coerce.number().positive().default(145000),
  BTC_TO_PHP_RATE:  z.coerce.number().positive().default(5800000),

  // 内部服务间通信 token
  INTERNAL_TOKEN: z.string().default(''),
})

const parsed = schema.parse(process.env)

if (parsed.NODE_ENV === 'production') {
  const missing: string[] = []
  if (!parsed.INTERNAL_TOKEN.trim()) missing.push('INTERNAL_TOKEN')
  if ((parsed.SG_MERCHANT_ID.trim() || parsed.SG_MERCHANT_KEY.trim()) && !parsed.SG_MERCHANT_KEY.trim()) {
    missing.push('SG_MERCHANT_KEY')
  }
  if ((parsed.WIN568_COMPANY_KEY.trim() || parsed.WIN568_SERVER_ID.trim()) && !parsed.WIN568_SERVER_ID.trim()) {
    missing.push('WIN568_SERVER_ID')
  }
  if (parsed.MATRIX_MERCHANT_NOTIFY_PRIVATE_KEY.trim() !== '' || parsed.MATRIX_PLATFORM_NOTIFY_PUBLIC_KEY.trim() !== '') {
    if (!parsed.MATRIX_MERCHANT_NOTIFY_PRIVATE_KEY.trim()) missing.push('MATRIX_MERCHANT_NOTIFY_PRIVATE_KEY')
    if (!parsed.MATRIX_PLATFORM_NOTIFY_PUBLIC_KEY.trim()) missing.push('MATRIX_PLATFORM_NOTIFY_PUBLIC_KEY')
  }
  if (missing.length) throw new Error(`Unsafe production configuration: ${missing.join(', ')}`)
}

export const env = parsed
