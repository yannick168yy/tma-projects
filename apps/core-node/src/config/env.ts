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
})

export const env = schema.parse(process.env)
