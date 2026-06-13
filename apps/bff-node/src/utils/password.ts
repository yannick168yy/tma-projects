import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)
const KEYLEN = 64
const FORMAT = 'scrypt'

/** 生成 `scrypt$<saltHex>$<hashHex>` 格式的密码哈希 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = (await scryptAsync(password, salt, KEYLEN)) as Buffer
  return `${FORMAT}$${salt.toString('hex')}$${hash.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [format, saltHex, hashHex] = stored.split('$')
  if (format !== FORMAT || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = (await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length)) as Buffer
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
