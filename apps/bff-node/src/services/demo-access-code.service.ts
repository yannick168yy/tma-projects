import { randomInt, timingSafeEqual } from 'node:crypto'
import type { Redis } from 'ioredis'

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const ACCESS_CODE_KEY = 'demo:admin:access-code'

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
    '账号 demoadmin',
    '密码 88888888',
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
