import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'

const LOG_KEY = 'sms:send-log'
const MAX_ENTRIES = 50
const LOG_TTL_SEC = 86400

export interface SmsSendLogEntry {
  id: string
  scene: string
  userId: string
  phone: string
  code: string
  text: string
  mocked: boolean
  createdAt: string
}

export async function appendSmsSendLog(
  redis: Redis,
  entry: Omit<SmsSendLogEntry, 'id' | 'createdAt'>,
): Promise<void> {
  const record: SmsSendLogEntry = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...entry,
  }
  await redis.lpush(LOG_KEY, JSON.stringify(record))
  await redis.ltrim(LOG_KEY, 0, MAX_ENTRIES - 1)
  await redis.expire(LOG_KEY, LOG_TTL_SEC)
}

export async function listSmsSendLogs(redis: Redis, limit = MAX_ENTRIES): Promise<SmsSendLogEntry[]> {
  const raw = await redis.lrange(LOG_KEY, 0, limit - 1)
  return raw.map((line) => JSON.parse(line) as SmsSendLogEntry)
}
