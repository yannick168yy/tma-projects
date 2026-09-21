import { randomInt, timingSafeEqual } from 'node:crypto'
import type { Redis } from 'ioredis'

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const ACCESS_CODE_KEY = 'demo:admin:access-code'
const PHT_OFFSET_MS = 8 * 60 * 60 * 1000
export const DEMO_ACCESS_FAILURE_LIMIT = 20

function accessFailureKey(ip: string): string {
  const date = new Date(Date.now() + PHT_OFFSET_MS).toISOString().slice(0, 10)
  return `admin:demo:access-code:fails:${date}:${ip}`
}

export function generateDemoAccessCode(): string {
  const chars = [
    LETTERS[randomInt(LETTERS.length)],
    DIGITS[randomInt(DIGITS.length)],
  ]
  const alphabet = LETTERS + DIGITS
  while (chars.length < 4) chars.push(alphabet[randomInt(alphabet.length)])
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

export function composeDemoAccessMessage(code: string): string {
  return [
    '演示后台',
    'demo-admin.betogo.games',
    `访问码 ${code}`,
  ].join('\n')
}

export async function setDemoAccessCode(redis: Redis, code: string): Promise<void> {
  await redis.set(ACCESS_CODE_KEY, code)
}

export async function verifyDemoAccessCode(redis: Redis, input?: string): Promise<boolean> {
  if (!input) return false
  const expected = await redis.get(ACCESS_CODE_KEY)
  const actual = input.trim().toUpperCase()
  if (!expected || actual.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
}

export async function isDemoAccessBlocked(redis: Redis, ip: string): Promise<boolean> {
  return Number(await redis.get(accessFailureKey(ip))) >= DEMO_ACCESS_FAILURE_LIMIT
}

export async function recordDemoAccessFailure(redis: Redis, ip: string): Promise<number> {
  const key = accessFailureKey(ip)
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 2 * 24 * 60 * 60)
  return count
}

export async function clearDemoAccessFailures(redis: Redis, ip: string): Promise<void> {
  await redis.del(accessFailureKey(ip))
}
