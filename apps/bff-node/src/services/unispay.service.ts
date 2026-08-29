import { createHash, timingSafeEqual } from 'node:crypto'
import type { Env } from '../config/env.js'

export class UnispayError extends Error {
  constructor(public readonly code: number, message: string) {
    super(`UnisPay error ${code}: ${message}`)
  }
}

export function generateSign(params: Record<string, unknown>, apiKey: string): string {
  const sorted = Object.entries(params)
    .filter(([k, v]) => k !== 'sign' && v !== null && v !== undefined && v !== '')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  return createHash('sha256').update(`${sorted}&key=${apiKey}`).digest('hex')
}

export function verifySign(params: Record<string, unknown>, apiKey: string): boolean {
  const received = String(params.sign ?? '')
  const expected = generateSign(params, apiKey)
  if (received.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected))
}

export function resolveDepositPayType(channelName: string): number {
  const name = channelName.toLowerCase()
  if (name === 'qris') return 6212
  if (name === 'dana') return 6211
  return 6210
}

export function buildDepositChannelExtra(channelName: string): string | undefined {
  const name = channelName.toLowerCase()
  if (resolveDepositPayType(name) !== 6210) return undefined
  return JSON.stringify({ bank: name.toUpperCase() })
}

export function resolveWithdrawPayType(_channelName: string): number {
  return 6210
}

async function request<T>(
  path: string,
  body: Record<string, unknown>,
  env: Env,
): Promise<T> {
  if (!env.UNISPAY_MCH_NO || !env.UNISPAY_API_KEY) {
    throw new UnispayError(500, 'UnisPay 商户配置缺失')
  }

  const payload: Record<string, unknown> = {
    ...body,
    mchNo: env.UNISPAY_MCH_NO,
    timestamp: String(Date.now()),
  }
  payload.sign = generateSign(payload, env.UNISPAY_API_KEY)

  const res = await fetch(`${env.UNISPAY_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=utf-8' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  })

  const json = await res.json() as { code: number; msg: string; data?: T }
  if (json.code !== 200 || !json.data) throw new UnispayError(json.code, json.msg || 'UnisPay 请求失败')
  return json.data
}

export interface CreateDepositParams {
  amount: number
  channelName: string
  merchantSerial: string
  notifyUrl: string
  returnUrl: string
}

export interface DepositOrderResult {
  platformId: string
  merchantSerial: string
  amount: number
  state: number
  payUrl: string
  qrcode?: string
  payType: number
  channelExtra?: string
}

export async function createDeposit(params: CreateDepositParams, env: Env): Promise<DepositOrderResult> {
  const payType = resolveDepositPayType(params.channelName)
  const channelExtra = buildDepositChannelExtra(params.channelName)
  const data = await request<{
    mchNo: string
    mchOrderId: string
    orderNo: string
    amount: string
    payUrl?: string
    qrcode?: string
    status: string
  }>('/api/order/create', {
    mchOrderId: params.merchantSerial,
    payType,
    amount: String(params.amount),
    notifyUrl: params.notifyUrl,
    returnUrl: params.returnUrl,
    ...(channelExtra ? { channelExtra } : {}),
  }, env)

  return {
    platformId: data.orderNo,
    merchantSerial: data.mchOrderId,
    amount: Number(data.amount),
    state: Number(data.status),
    payUrl: data.payUrl ?? '',
    qrcode: data.qrcode,
    payType,
    channelExtra,
  }
}

export interface CreateWithdrawalParams {
  merchantSerial: string
  amount: number
  channelName: string
  targetOwner: string
  targetAccount: string
  notifyUrl: string
}

export interface WithdrawalOrderResult {
  platformId: string
  merchantSerial: string
  amount: number
  state: number
}

export interface UnispayOrderQueryResult {
  platformId: string
  merchantSerial: string
  amount: number
  state: number
}

function normalizeOrderResult(data: {
  mchOrderId?: string
  merchantSerial?: string
  orderNo?: string
  platformId?: string
  amount?: string | number
  status?: string | number
}): UnispayOrderQueryResult {
  return {
    platformId: String(data.orderNo ?? data.platformId ?? ''),
    merchantSerial: String(data.mchOrderId ?? data.merchantSerial ?? ''),
    amount: Number(data.amount ?? 0),
    state: Number(data.status ?? 0),
  }
}

export async function queryDeposit(merchantSerial: string, env: Env): Promise<UnispayOrderQueryResult> {
  const data = await request<Record<string, string | number>>('/api/order/query', { mchOrderId: merchantSerial }, env)
  return normalizeOrderResult(data)
}

export async function queryWithdrawal(merchantSerial: string, env: Env): Promise<UnispayOrderQueryResult> {
  const data = await request<Record<string, string | number>>('/api/payout/query', { mchOrderId: merchantSerial }, env)
  return normalizeOrderResult(data)
}

export async function getBalance(env: Env): Promise<{ balance: number; frozen: number; currency: string }> {
  const data = await request<Record<string, string | number>>('/api/mch/balance', {}, env)
  const balance = Number(data.balance ?? data.availableBalance ?? data.available ?? data.amount ?? 0)
  const frozen = Number(data.frozen ?? data.frozenBalance ?? data.freezeBalance ?? data.freezeAmount ?? 0)
  return {
    balance: Number.isFinite(balance) ? balance : 0,
    frozen: Number.isFinite(frozen) ? frozen : 0,
    currency: String(data.currency ?? 'IDR'),
  }
}

export async function createWithdrawal(params: CreateWithdrawalParams, env: Env): Promise<WithdrawalOrderResult> {
  const data = await request<{
    mchNo: string
    mchOrderId: string
    orderNo: string
    amount: string
    status: string
  }>('/api/payout/create', {
    mchOrderId: params.merchantSerial,
    payType: resolveWithdrawPayType(params.channelName),
    paymentMethod: params.channelName.toUpperCase(),
    accNumber: params.targetAccount,
    accName: params.targetOwner,
    amount: String(Math.trunc(params.amount)),
    notifyUrl: params.notifyUrl,
  }, env)

  return {
    platformId: data.orderNo,
    merchantSerial: data.mchOrderId,
    amount: Number(data.amount),
    state: Number(data.status),
  }
}
