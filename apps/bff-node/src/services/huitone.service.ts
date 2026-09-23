import { createHash, timingSafeEqual } from 'node:crypto'
import type { Env } from '../config/env.js'

export class HuitoneError extends Error {
  constructor(public readonly code: string | number, message: string) {
    super(`Huitone error ${code}: ${message}`)
  }
}

export function generateSign(params: Record<string, unknown>, merchantKey: string): string {
  const sorted = Object.entries(params)
    .filter(([key, value]) => key !== 'sign' && value !== null && value !== undefined && value !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  return createHash('md5').update(`${sorted}${merchantKey}`).digest('hex').toUpperCase()
}

export function verifySign(params: Record<string, unknown>, merchantKey: string): boolean {
  const received = String(params.sign ?? '').toUpperCase()
  const expected = generateSign(params, merchantKey)
  if (received.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected))
}

export function generateCustomerContact(userId: string): { mobile: string; email: string } {
  const digest = createHash('sha256').update(`huitone:${userId}`).digest()
  const firstDigit = String(6 + (digest[0] % 4))
  const suffix = Array.from(digest.subarray(1, 10), (value) => String(value % 10)).join('')
  return {
    mobile: `${firstDigit}${suffix}`,
    email: `huitone-${digest.toString('hex').slice(0, 16)}@188facai.com`,
  }
}

interface HuitoneResponse<T> {
  success: boolean
  code?: string | number
  message?: string
  result?: T
}

function requireConfig(env: Env): void {
  if (!env.HUITONE_MERCHANT_ID || !env.HUITONE_MERCHANT_KEY) {
    throw new HuitoneError(500, 'Huitone 商户配置缺失')
  }
}

function stringParams(params: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => [key, String(value)]),
  )
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, unknown>,
  env: Env,
): Promise<T> {
  requireConfig(env)
  const unsigned = stringParams({
    mchtId: env.HUITONE_MERCHANT_ID,
    timestamp: Date.now(),
    ...params,
  })
  const payload = { ...unsigned, sign: generateSign(unsigned, env.HUITONE_MERCHANT_KEY) }
  const query = method === 'GET' ? `?${new URLSearchParams(payload).toString()}` : ''
  const res = await fetch(`${env.HUITONE_BASE_URL}${path}${query}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(payload) : undefined,
    signal: AbortSignal.timeout(15000),
  })
  const json = await res.json() as HuitoneResponse<T>
  if (!json.success || json.result === undefined || json.result === null) {
    throw new HuitoneError(json.code ?? res.status, json.message || 'Huitone 请求失败')
  }
  return json.result
}

function amountString(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) throw new HuitoneError(400, 'Huitone INR 金额必须大于 0')
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2)
}

export interface HuitoneWalletLink {
  clickUrl?: string
  walletCode?: string
}

export interface DepositOrderResult {
  platformId: string
  merchantSerial: string
  payUrl: string
  upi?: string
  upiLink?: string
  walletList?: HuitoneWalletLink[]
}

export async function createDeposit(params: {
  amount: number
  merchantSerial: string
  notifyUrl: string
  name: string
  mobile: string
  email: string
}, env: Env): Promise<DepositOrderResult> {
  const data = await request<{
    outTradeNo: string
    transNo: string
    link: string
    upi?: string
    upiLink?: string
    walletList?: HuitoneWalletLink[]
  }>('POST', '/v1/pay/payIn', {
    outTradeNo: params.merchantSerial,
    transAmt: amountString(params.amount),
    notifyUrl: params.notifyUrl,
    subject: 'BetoGo deposit',
    name: params.name,
    mobile: params.mobile,
    email: params.email,
  }, env)
  return {
    platformId: String(data.transNo),
    merchantSerial: String(data.outTradeNo),
    payUrl: String(data.link),
    upi: data.upi,
    upiLink: data.upiLink,
    walletList: data.walletList,
  }
}

export interface WithdrawalOrderResult {
  platformId: string
  merchantSerial: string
}

export async function createWithdrawal(params: {
  amount: number
  merchantSerial: string
  notifyUrl: string
  accountName: string
  accountNo: string
  ifsc: string
  mobile?: string
  email?: string
}, env: Env): Promise<WithdrawalOrderResult> {
  if (!params.ifsc.trim()) throw new HuitoneError(400, 'Huitone 代付必须填写 IFSC')
  const data = await request<{ outTradeNo: string; transNo: string }>('POST', '/v1/pay/payOut', {
    outTradeNo: params.merchantSerial,
    transAmt: amountString(params.amount),
    notifyUrl: params.notifyUrl,
    subject: 'BetoGo withdrawal',
    accountName: params.accountName,
    accountNo: params.accountNo,
    ifsc: params.ifsc.trim().toUpperCase(),
    mobile: params.mobile,
    email: params.email,
  }, env)
  return { platformId: String(data.transNo), merchantSerial: String(data.outTradeNo) }
}

export type HuitoneTransStatus = 'SUCCESS' | 'FAIL' | 'PROCESSING'

export interface HuitoneOrderResult {
  platformId: string
  merchantSerial: string
  status: HuitoneTransStatus
  amount: number
  completionTime: string
  utr?: string
}

export async function queryOrder(
  opts: { transNo?: string; outTradeNo?: string },
  env: Env,
): Promise<HuitoneOrderResult> {
  if (!opts.transNo && !opts.outTradeNo) throw new HuitoneError(400, 'transNo、outTradeNo 必须提供一个')
  const data = await request<{
    transNo: string
    outTradeNo: string
    transStatus: HuitoneTransStatus
    transAmt: number | string
    completionTime: string
    utr?: string
  }>('GET', '/v1/pay/query', opts, env)
  return {
    platformId: String(data.transNo),
    merchantSerial: String(data.outTradeNo),
    status: data.transStatus,
    amount: Number(data.transAmt),
    completionTime: String(data.completionTime),
    utr: data.utr,
  }
}

export const queryDeposit = (merchantSerial: string, env: Env) => queryOrder({ outTradeNo: merchantSerial }, env)
export const queryWithdrawal = (merchantSerial: string, env: Env) => queryOrder({ outTradeNo: merchantSerial }, env)

export async function getBalance(env: Env): Promise<{ balance: number; frozen: number; currency: string }> {
  const data = await request<{ balanceAmt: number | string }>('GET', '/v1/pay/balance', {}, env)
  return { balance: Number(data.balanceAmt) || 0, frozen: 0, currency: 'INR' }
}

export async function replenish(
  params: { utr: string; transNo?: string; outTradeNo?: string },
  env: Env,
): Promise<{ status: string; message?: string }> {
  if (!params.transNo && !params.outTradeNo) throw new HuitoneError(400, 'transNo、outTradeNo 必须提供一个')
  const data = await request<{ replenishStatus: string; replenishMsg?: string }>(
    'POST', '/v1/pay/replenish', params, env,
  )
  return { status: data.replenishStatus, message: data.replenishMsg }
}

export async function queryUtr(utr: string, env: Env): Promise<{
  amount: number
  status: string
  platformId: string
  merchantSerial: string
}> {
  const data = await request<{
    amount: string
    utrStatus: string
    transNo: string
    outTradeNo: string
  }>('GET', '/v1/pay/query/utr', { utr }, env)
  return {
    amount: Number(data.amount),
    status: data.utrStatus,
    platformId: data.transNo,
    merchantSerial: data.outTradeNo,
  }
}

export async function queryUpi(upi: string, env: Env): Promise<boolean> {
  return request<boolean>('GET', '/v1/pay/query/upi', { upi }, env)
}
