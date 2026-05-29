import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyRequest } from 'fastify'

export type VerifyFn = (req: FastifyRequest, env: Record<string, string>) => boolean

// ── YFPay ─────────────────────────────────────────────────────────────────────
// 签名算法：将非空参数按 key 字母序排列后 MD5，格式: k=v&k=v&key=<apiKey>

function yfpaySign(params: Record<string, unknown>, apiKey: string): string {
  const sorted = Object.entries(params)
    .filter(([k, v]) => k !== 'sign' && v !== null && v !== undefined && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  return createHash('md5').update(`${sorted}&key=${apiKey}`).digest('hex').toUpperCase()
}

function verifyYfpay(req: FastifyRequest, env: Record<string, string>): boolean {
  const apiKey = env['YFPAY_API_KEY']
  if (!apiKey) return false
  const body = req.body as Record<string, unknown>
  const received = String(body['sign'] ?? '')
  const expected = yfpaySign(body, apiKey)
  if (received.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected))
}

// ── Slotegrator (SG) ─────────────────────────────────────────────────────────
// 签名算法：body 参数 + 三个 X-Header 按 key 字母序合并后 HMAC-SHA1

function sgSign(params: Record<string, string | number>, merchantKey: string): string {
  const sorted = Object.keys(params).sort()
  const usp = new URLSearchParams()
  for (const k of sorted) usp.append(k, String(params[k]))
  return createHmac('sha1', merchantKey).update(usp.toString()).digest('hex')
}

function verifySg(req: FastifyRequest, env: Record<string, string>): boolean {
  const merchantKey = env['SG_MERCHANT_KEY']
  if (!merchantKey) return false
  const get = (k: string): string => {
    const v = req.headers[k.toLowerCase()]
    return Array.isArray(v) ? v[0] : (v ?? '')
  }
  const body = req.body as Record<string, string>
  const merged: Record<string, string | number> = {
    ...body,
    'X-Merchant-Id': get('X-Merchant-Id'),
    'X-Timestamp': get('X-Timestamp'),
    'X-Nonce': get('X-Nonce'),
  }
  return sgSign(merged, merchantKey) === get('X-Sign')
}

// ── 注册表 ────────────────────────────────────────────────────────────────────

export const providerVerifiers: Record<string, VerifyFn> = {
  yfpay: verifyYfpay,
  sg: verifySg,
}
