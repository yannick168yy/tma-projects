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

  // YFPay 回调验签
  YFPAY_API_KEY: z.string().default(''),

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

export const env = schema.parse(process.env)
