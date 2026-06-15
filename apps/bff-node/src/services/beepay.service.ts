/**
 * BeePay 支付服务
 * 签名：MD5 小写（注意与 yfpay 大写不同）；补充参数(method/callbackUrl)不参与签名
 * 状态码：0待付 / 1已付 / 2失败（与 yfpay 不同，对外查询归一化为 yfpay 约定）
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import type { Env } from '../config/env.js'

// 菲律宾代收支付类型：钱包名 → method（补充参数，不参与签名）
const DEPOSIT_METHOD: Record<string, string> = {
  GCASH: '1203', // Gcash 原生（返回 payUrl 跳转）
  MAYA: '1201',  // MAYA
}
// 菲律宾代付钱包编码：钱包名 → method（补充参数，不参与签名）
const WITHDRAW_METHOD: Record<string, string> = {
  GCASH: 'GCASH',
  MAYA: 'MAYA',
}

const CURRENCY = 'PHP'

// ── 签名 ────────────────────────────────────────────────────────────────────

export function generateSign(params: Record<string, unknown>, apiKey: string): string {
  const sorted = Object.entries(params)
    .filter(([k, v]) => k !== 'sign' && v !== null && v !== undefined && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')

  return createHash('md5').update(`${sorted}&key=${apiKey}`).digest('hex') // 小写
}

export function verifySign(params: Record<string, unknown>, apiKey: string): boolean {
  const expected = generateSign(params, apiKey)
  const received = String(params['sign'] ?? '')
  if (received.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected))
}

// 原生状态(0待付/1已付/2失败) → 统一前端约定(0待付/2已付/3失败，与 yfpay 对齐)
function toUnifiedState(status: number): number {
  return status === 1 ? 2 : status === 2 ? 3 : 0
}

// ── HTTP 基础请求 ────────────────────────────────────────────────────────────

interface BeepayRaw {
  channelOrderNo: string
  tradeNo: string
  midNo: string
  amount: number | string
  status: number
  payUrl?: string
  qrcode?: string
}

export class BeepayError extends Error {
  constructor(public readonly code: number, message: string) {
    super(`BeePay error ${code}: ${message}`)
  }
}

// signParams 参与签名（自动补 midNo）；extraParams 为补充参数（method 等），不参与签名
async function request<T>(
  path: string,
  signParams: Record<string, unknown>,
  env: Env,
  extraParams: Record<string, unknown> = {},
): Promise<T> {
  const signed = { ...signParams, midNo: env.BEEPAY_MID_NO }
  const sign = generateSign(signed, env.BEEPAY_API_KEY)
  const body = { ...signed, ...extraParams, sign }

  const res = await fetch(`${env.BEEPAY_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', midNo: env.BEEPAY_MID_NO },
    body: JSON.stringify(body),
  })

  const json = await res.json() as { code: string; msg: string; data: T }
  if (String(json.code) !== '0') {
    throw new BeepayError(Number(json.code) || -1, json.msg || 'BeePay 请求失败')
  }
  return json.data
}

// ── 代收 ────────────────────────────────────────────────────────────────────

export interface BeepayDepositResult {
  platformId: string
  merchantSerial: string
  amount: number
  state: number
  payUrl: string
}

export async function createDeposit(
  params: { amount: number; channelCode: string; merchantSerial: string; notifyUrl: string },
  env: Env,
): Promise<BeepayDepositResult> {
  const method = DEPOSIT_METHOD[params.channelCode.toUpperCase()]
  if (!method) throw new BeepayError(400, `BeePay 不支持代收渠道 ${params.channelCode}`)

  const data = await request<BeepayRaw>(
    '/order/pay/in',
    { tradeNo: params.merchantSerial, amount: params.amount, notifyUrl: params.notifyUrl, currency: CURRENCY },
    env,
    { method },
  )
  return {
    platformId: data.channelOrderNo,
    merchantSerial: data.tradeNo,
    amount: Number(data.amount),
    state: data.status,
    payUrl: data.payUrl ?? '',
  }
}

export async function queryDeposit(
  merchantSerial: string,
  env: Env,
): Promise<{ state: number }> {
  const data = await request<BeepayRaw>('/order/query', { tradeNo: merchantSerial, payType: '00' }, env)
  return { state: toUnifiedState(data.status) }
}

// ── 代付 ────────────────────────────────────────────────────────────────────

export interface BeepayWithdrawalResult {
  platformId: string
  merchantSerial: string
  amount: number
  state: number
}

export async function createWithdrawal(
  params: {
    merchantSerial: string; amount: number
    targetOwner: string; targetAccount: string
    channelCode: string; notifyUrl: string
  },
  env: Env,
): Promise<BeepayWithdrawalResult> {
  const method = WITHDRAW_METHOD[params.channelCode.toUpperCase()]
  if (!method) throw new BeepayError(400, `BeePay 不支持代付渠道 ${params.channelCode}`)

  const data = await request<BeepayRaw>(
    '/withdraw/pay/out',
    {
      tradeNo: params.merchantSerial,
      amount: params.amount,
      accountType: 1, // 1 钱包账户（gcash/maya）
      cardName: params.targetOwner,
      cardNo: params.targetAccount,
      notifyUrl: params.notifyUrl,
      currency: CURRENCY,
    },
    env,
    { method },
  )
  return {
    platformId: data.channelOrderNo,
    merchantSerial: data.tradeNo,
    amount: Number(data.amount),
    state: data.status,
  }
}

export async function queryWithdrawal(
  merchantSerial: string,
  env: Env,
): Promise<{ state: number }> {
  const data = await request<BeepayRaw>('/order/query', { tradeNo: merchantSerial, payType: '01' }, env)
  return { state: data.status }
}

// ── 查询余额 ─────────────────────────────────────────────────────────────────

export async function getBalance(env: Env, currency = CURRENCY): Promise<{ midNo: string; balance: number; currency: string }> {
  return request('/accInf/balance', { currency }, env)
}
