import { createHash, timingSafeEqual } from 'node:crypto'
import type { Env } from '../config/env.js'

export class WzpayError extends Error {
  constructor(public readonly code: string | number, message: string) {
    super(`WZPAY error ${code}: ${message}`)
  }
}

export function generateSign(params: Record<string, unknown>, apiKey: string): string {
  const sorted = Object.entries(params)
    .filter(([key, value]) => key !== 'sign' && value !== null && value !== undefined && value !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  return createHash('md5').update(`${sorted}&key=${apiKey}`).digest('hex').toLowerCase()
}

export function verifySign(params: Record<string, unknown>, apiKey: string): boolean {
  const received = String(params.sign ?? '').toLowerCase()
  const expected = generateSign(params, apiKey)
  if (received.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected))
}

export function generateWzpayContact(userId: string): { phone: string; email: string } {
  const digest = createHash('sha256').update(`wzpay:${userId}`).digest()
  const phoneSuffix = Array.from(digest.subarray(0, 8), (value) => String(value % 10)).join('')
  return {
    phone: `0812${phoneSuffix}`,
    email: `wzpay-${digest.toString('hex').slice(0, 16)}@188facai.com`,
  }
}

async function request<T>(
  path: string,
  required: Record<string, unknown>,
  optional: Record<string, unknown>,
  env: Env,
): Promise<T> {
  if (!env.WZPAY_MERCHANT_ID || !env.WZPAY_API_KEY) {
    throw new WzpayError(500, 'WZPAY 商户配置缺失')
  }
  const payload = {
    ...required,
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== null && value !== undefined && value !== '')),
    sign: generateSign(required, env.WZPAY_API_KEY),
  }
  const res = await fetch(`${env.WZPAY_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  })
  const json = await res.json() as { code: string | number; msg?: string; data?: T }
  if (![0, 200].includes(Number(json.code)) || json.data === undefined) {
    throw new WzpayError(json.code, json.msg || 'WZPAY 请求失败')
  }
  return json.data
}

export interface CreateDepositParams {
  amount: number
  channelName: string
  merchantSerial: string
  phone: string
  name: string
  email: string
  notifyUrl: string
  callbackUrl: string
}

export interface DepositOrderResult {
  platformId: string
  merchantSerial: string
  amount: number
  state: number
  payUrl: string
  qrcode?: string
}

export async function createDeposit(params: CreateDepositParams, env: Env): Promise<DepositOrderResult> {
  if (!Number.isInteger(params.amount) || params.amount <= 0) {
    throw new WzpayError(400, 'WZPAY IDR 代收金额必须为正整数')
  }
  const method = params.channelName.toUpperCase()
  if (!['DANA', 'QRIS', 'LINKAJA', 'OVO'].includes(method)) {
    throw new WzpayError(400, `WZPAY 不支持代收方式 ${params.channelName}`)
  }
  const data = await request<{
    orderId: string
    outTradeId: string
    amount: string
    status: number | string
    payUrl?: string
    qrCode?: string
  }>('/core/api/collect/indonesia', {
    merchantId: env.WZPAY_MERCHANT_ID,
    outTradeId: params.merchantSerial,
    amount: String(Math.trunc(params.amount)),
    currency: 'IDR',
    method,
    phone: params.phone,
    name: params.name,
    email: params.email,
    title: 'BetoGo Deposit',
    description: 'BetoGo account deposit',
  }, {
    notifyUrl: params.notifyUrl,
    callbackUrl: params.callbackUrl,
    directConnect: '1',
  }, env)
  return {
    platformId: String(data.orderId),
    merchantSerial: String(data.outTradeId),
    amount: Number(data.amount),
    state: Number(data.status),
    payUrl: data.payUrl ?? '',
    qrcode: data.qrCode,
  }
}

export interface CreateWithdrawalParams {
  merchantSerial: string
  amount: number
  channelName: string
  targetOwner: string
  targetAccount: string
  accountMobile: string
  accountEmail: string
  notifyUrl: string
}

export interface WithdrawalOrderResult {
  platformId: string
  merchantSerial: string
  amount: number
  state: number
}

export async function createWithdrawal(params: CreateWithdrawalParams, env: Env): Promise<WithdrawalOrderResult> {
  if (!Number.isInteger(params.amount) || params.amount <= 0) {
    throw new WzpayError(400, 'WZPAY IDR 代付金额必须为正整数')
  }
  const channelName = params.channelName.toLowerCase()
  if (!['dana', 'gopay', 'linkaja', 'ovo'].includes(channelName)) {
    throw new WzpayError(400, `WZPAY 暂未配置代付银行编号 ${params.channelName}`)
  }
  const method = channelName
  const bankCode = channelName.toUpperCase()
  const data = await request<{
    orderId: string
    outTradeId: string
    amount: string
    status: number | string
  }>('/core/api/pay/indonesia', {
    merchantId: env.WZPAY_MERCHANT_ID,
    outTradeId: params.merchantSerial,
    currency: 'IDR',
    amount: String(Math.trunc(params.amount)),
    method,
    bankCode,
    bankCard: params.targetAccount,
    accountMobile: params.accountMobile,
    accountEmail: params.accountEmail,
    accountName: params.targetOwner,
    name: params.targetOwner,
    bankName: bankCode,
  }, {
    notifyUrl: params.notifyUrl,
  }, env)
  return {
    platformId: String(data.orderId),
    merchantSerial: String(data.outTradeId),
    amount: Number(data.amount),
    state: Number(data.status),
  }
}

export interface WzpayOrderQueryResult {
  platformId: string
  merchantSerial: string
  amount: number
  state: number
}

export async function queryOrder(merchantSerial: string, payType: '0' | '1', env: Env): Promise<WzpayOrderQueryResult> {
  const data = await request<Array<Record<string, string | number>>>('/core/api/order/query', {
    merchantId: env.WZPAY_MERCHANT_ID,
    payType,
  }, {
    outTradeId: merchantSerial,
  }, env)
  const order = data[0]
  if (!order) throw new WzpayError(404, 'WZPAY 订单不存在')
  return {
    platformId: String(order.orderId ?? order.order_id ?? ''),
    merchantSerial: String(order.outTradeId ?? order.out_trade_id ?? ''),
    amount: Number(order.amount ?? 0),
    state: Number(order.status ?? 0),
  }
}

export const queryDeposit = (merchantSerial: string, env: Env) => queryOrder(merchantSerial, '0', env)
export const queryWithdrawal = (merchantSerial: string, env: Env) => queryOrder(merchantSerial, '1', env)

export async function getBalance(env: Env): Promise<{ balance: number; frozen: number; currency: string }> {
  const data = await request<{ balance: string | number; currency?: string }>('/core/api/balance/query', {
    merchantId: env.WZPAY_MERCHANT_ID,
    currency: 'IDR',
  }, {}, env)
  return {
    balance: Number(data.balance) || 0,
    frozen: 0,
    currency: String(data.currency ?? 'IDR'),
  }
}
