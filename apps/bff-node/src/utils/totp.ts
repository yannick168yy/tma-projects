import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const STEP_SECONDS = 30
const DIGITS = 6

export function generateTotpSecret(): string {
  const bytes = randomBytes(20)
  let bits = ''
  for (const b of bytes) bits += b.toString(2).padStart(8, '0')
  let out = ''
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0')
    out += BASE32_ALPHABET[parseInt(chunk, 2)]
  }
  return out
}

function decodeBase32(secret: string): Buffer {
  const clean = secret.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase()
  let bits = ''
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char)
    if (idx < 0) throw new Error('Invalid TOTP secret')
    bits += idx.toString(2).padStart(5, '0')
  }
  const bytes: number[] = []
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2))
  }
  return Buffer.from(bytes)
}

function hotp(secret: string, counter: number): string {
  const key = decodeBase32(secret)
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', key).update(msg).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const bin =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0')
}

export function verifyTotpCode(secret: string, code: string, now = Date.now()): boolean {
  const clean = code.trim()
  if (!/^\d{6}$/.test(clean)) return false
  const current = Math.floor(now / 1000 / STEP_SECONDS)
  for (const offset of [-1, 0, 1]) {
    const expected = hotp(secret, current + offset)
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return true
  }
  return false
}

export function buildTotpUri(params: { issuer: string; account: string; secret: string }): string {
  const label = `${params.issuer}:${params.account}`
  const q = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })
  return `otpauth://totp/${encodeURIComponent(label)}?${q.toString()}`
}
