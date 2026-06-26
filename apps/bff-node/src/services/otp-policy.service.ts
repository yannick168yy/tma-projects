import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import { getAdminSetting } from './admin-store.js'

export const SMS_DAILY_LIMIT_KEY = 'sms_daily_limit_per_user'
export const SMS_DAILY_IP_LIMIT_KEY = 'sms_daily_limit_per_ip'
export const DEFAULT_SMS_DAILY_LIMIT = 30
export const DEFAULT_SMS_DAILY_IP_LIMIT = 100

const DAY_MS = 86_400_000
const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000

function smsDailyKey(subject: string): string {
  const now = Date.now()
  const day = new Date(now + UTC8_OFFSET_MS).toISOString().slice(0, 10)
  return `sms:daily:${day}:${subject}`
}

function ttlUntilNextUtc8Day(): number {
  const now = Date.now()
  const dayStart = Math.floor((now + UTC8_OFFSET_MS) / DAY_MS) * DAY_MS - UTC8_OFFSET_MS
  return Math.max(60, Math.ceil((dayStart + DAY_MS - now) / 1000))
}

export async function getSmsDailyLimit(env: Env): Promise<number> {
  const raw = await getAdminSetting(env, SMS_DAILY_LIMIT_KEY)
  const n = raw == null ? NaN : Number(raw)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_SMS_DAILY_LIMIT
}

export async function getSmsDailyIpLimit(env: Env): Promise<number> {
  const raw = await getAdminSetting(env, SMS_DAILY_IP_LIMIT_KEY)
  const n = raw == null ? NaN : Number(raw)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_SMS_DAILY_IP_LIMIT
}

export async function enforceSmsDailyLimit(redis: Redis, limit: number, subject: string): Promise<void> {
  const sent = Number(await redis.get(smsDailyKey(subject)) ?? 0)
  if (sent >= limit) throw new Error('kyc.errors.smsDailyLimit')
}

export async function recordSmsSent(redis: Redis, subject: string): Promise<void> {
  const key = smsDailyKey(subject)
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, ttlUntilNextUtc8Day())
}
