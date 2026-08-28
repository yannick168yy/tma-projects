import { createHash, timingSafeEqual } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { verifyNotifySignature, normalizePem, type MatrixEnvelope } from '../utils/matrix-crypto.js'

export type VerifyFn = (req: FastifyRequest, env: Record<string, string>) => boolean

// ── YFPay ─────────────────────────────────────────────────────────────────────
// 签名算法：将非空参数按 key 字母序排列后 MD5，格式: k=v&k=v&key=<apiKey>

const YFPAY_CALLBACK_IPS = new Set([
  '103.145.58.175',
  '64.118.137.98',
  '47.236.21.68',
])

function normalizeIp(ip: string): string {
  return ip.trim().replace(/^::ffff:/, '')
}

function getClientIp(req: FastifyRequest): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return normalizeIp(forwarded.split(',')[0])
  }
  const realIp = req.headers['x-real-ip']
  if (typeof realIp === 'string' && realIp.trim()) {
    return normalizeIp(realIp)
  }
  return normalizeIp(req.ip)
}

function yfpaySign(params: Record<string, unknown>, apiKey: string): string {
  const sorted = Object.entries(params)
    .filter(([k, v]) => k !== 'sign' && v !== null && v !== undefined && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  return createHash('md5').update(`${sorted}&key=${apiKey}`).digest('hex').toUpperCase()
}

function verifyYfpay(req: FastifyRequest, env: Record<string, string>): boolean {
  const apiKey = env['YFPAY_API_KEY']
  if (!apiKey) return false
  if (!YFPAY_CALLBACK_IPS.has(getClientIp(req))) return false
  const body = req.body as Record<string, unknown>
  const received = String(body['sign'] ?? '')
  const expected = yfpaySign(body, apiKey)
  if (received.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected))
}

// ── BeePay ──────────────────────────────────────────────────────────────────
// 签名算法：非空参数按 key 字母序排列后 MD5（小写），格式: k=v&k=v&key=<apiKey>

function beepaySign(params: Record<string, unknown>, apiKey: string): string {
  const sorted = Object.entries(params)
    .filter(([k, v]) => k !== 'sign' && v !== null && v !== undefined && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  return createHash('md5').update(`${sorted}&key=${apiKey}`).digest('hex')
}

function verifyBeepay(req: FastifyRequest, env: Record<string, string>): boolean {
  const apiKey = env['BEEPAY_API_KEY']
  if (!apiKey) return false
  const body = req.body as Record<string, unknown>
  const received = String(body['sign'] ?? '')
  const expected = beepaySign(body, apiKey)
  if (received.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected))
}

// ── UnisPay ──────────────────────────────────────────────────────────────────
// 签名算法：非空参数按 key 字母序排列后 SHA-256 小写，格式: k=v&k=v&key=<apiKey>

function unispaySign(params: Record<string, unknown>, apiKey: string): string {
  const sorted = Object.entries(params)
    .filter(([k, v]) => k !== 'sign' && v !== null && v !== undefined && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  return createHash('sha256').update(`${sorted}&key=${apiKey}`).digest('hex')
}

function verifyUnispay(req: FastifyRequest, env: Record<string, string>): boolean {
  const apiKey = env['UNISPAY_API_KEY']
  if (!apiKey) return false
  const body = req.body as Record<string, unknown>
  const received = String(body['sign'] ?? '')
  const expected = unispaySign(body, apiKey)
  if (received.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected))
}

// ── Matrix ────────────────────────────────────────────────────────────────────

function verifyMatrix(req: FastifyRequest, env: Record<string, string>): boolean {
  const pubKey = env['MATRIX_PLATFORM_NOTIFY_PUBLIC_KEY']
  if (!pubKey) {
    console.error('[matrix-verify] MATRIX_PLATFORM_NOTIFY_PUBLIC_KEY 未配置')
    return false
  }
  const normalized = normalizePem(pubKey)
  const envelope = req.body as MatrixEnvelope
  const signStr = `data=${envelope.data}&key=${envelope.key}&timestamp=${envelope.timestamp}`
  console.error('[matrix-verify] pubKey前60字符:', JSON.stringify(normalized.slice(0, 60)))
  console.error('[matrix-verify] pubKey末30字符:', JSON.stringify(normalized.slice(-30)))
  console.error('[matrix-verify] signStr前100字符:', signStr.slice(0, 100))
  console.error('[matrix-verify] timestamp:', envelope.timestamp, 'sig前30:', envelope.sig?.slice(0, 30))
  try {
    const ok = verifyNotifySignature(envelope, normalized)
    console.error('[matrix-verify] 验签结果:', ok)
    return ok
  } catch (err) {
    console.error('[matrix-verify] 验签异常:', err)
    return false
  }
}

// ── 注册表 ────────────────────────────────────────────────────────────────────

export const providerVerifiers: Record<string, VerifyFn> = {
  yfpay: verifyYfpay,
  beepay: verifyBeepay,
  unispay: verifyUnispay,
  matrix: verifyMatrix,
}
