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

  // YFPay 回调验签
  YFPAY_API_KEY: z.string().default(''),

  // 内部服务间通信 token
  INTERNAL_TOKEN: z.string().default(''),
})

export const env = schema.parse(process.env)
