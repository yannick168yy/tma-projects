import { createHash } from 'node:crypto'
import type { Env } from '../config/env.js'

const BASE_URL = 'https://gateway.yfpay.me'

// ── 签名 ────────────────────────────────────────────────────────────────────

export function generateSign(params: Record<string, unknown>, apiKey: string): string {
  const sorted = Object.entries(params)
    .filter(([k, v]) => k !== 'sign' && v !== null && v !== undefined && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')

  const raw = `${sorted}&key=${apiKey}`
  return createHash('md5').update(raw).digest('hex').toUpperCase()
}

export function verifySign(params: Record<string, unknown>, apiKey: string): boolean {
  const expected = generateSign(params, apiKey)
  return params['sign'] === expected
}

// ── HTTP 基础请求 ────────────────────────────────────────────────────────────

async function request<T>(
  path: string,
  body: Record<string, unknown>,
  env: Env,
): Promise<T> {
  const payload: Record<string, unknown> = {
    ...body,
    username: env.YFPAY_USERNAME,
    timestamp: Date.now(),
  }
  payload['sign'] = generateSign(payload, env.YFPAY_API_KEY)

  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(payload),
  })

  const json = await res.json() as { code: number; msg: string; data: T }
  if (json.code !== 200) {
    throw new YfPayError(json.code, json.msg)
  }
  return json.data
}

export class YfPayError extends Error {
  constructor(public readonly code: number, message: string) {
    super(`YfPay error ${code}: ${message}`)
  }
}

// ── 代收 ────────────────────────────────────────────────────────────────────

export interface DepositChannel {
  code: string
  name: string
  min: number
  max: number
}

export async function getDepositChannels(env: Env): Promise<DepositChannel[]> {
  return request<DepositChannel[]>('/gateway-api/deposit/channels', {}, env)
}

export interface CreateDepositParams {
  amount: number          // PHP 金额（非分）
  channelCode: string
  merchantSerial: string
  notifyUrl: string
  extraParams?: string
}

export interface DepositOrderResult {
  platformId: string
  merchantSerial: string
  amount: number
  state: number
  url: string
  channelCode: string
  payAccount?: string
  extraParams?: string
}

export async function createDeposit(
  params: CreateDepositParams,
  env: Env,
): Promise<DepositOrderResult> {
  return request<DepositOrderResult>('/gateway-api/deposit/create', params as unknown as Record<string, unknown>, env)
}

export async function queryDeposit(
  merchantSerial: string,
  env: Env,
): Promise<DepositOrderResult> {
  return request<DepositOrderResult>('/gateway-api/deposit/get', { merchantSerial }, env)
}

// ── 代付 ────────────────────────────────────────────────────────────────────

export interface BankCode {
  code: string
  name: string
}

export async function getBankCodes(env: Env): Promise<BankCode[]> {
  return request<BankCode[]>('/gateway-api/withdrawal/bank-codes', {}, env)
}

export interface CreateWithdrawalParams {
  merchantSerial: string
  amount: number
  targetOwner: string
  targetAccount: string
  notifyUrl: string
  optionCode?: string
  bankName?: string
  extraParams?: string
}

export interface WithdrawalOrderResult {
  platformId: string
  merchantSerial: string
  amount: number
  state: number
  optionCode?: string
  extraParams?: string
}

export async function createWithdrawal(
  params: CreateWithdrawalParams,
  env: Env,
): Promise<WithdrawalOrderResult> {
  return request<WithdrawalOrderResult>('/gateway-api/withdrawal/create', params as unknown as Record<string, unknown>, env)
}

export async function queryWithdrawal(
  merchantSerial: string,
  env: Env,
): Promise<WithdrawalOrderResult> {
  return request<WithdrawalOrderResult>('/gateway-api/withdrawal/get', { merchantSerial }, env)
}

// ── 查询余额 ─────────────────────────────────────────────────────────────────

export async function getBalance(env: Env): Promise<{ balance: number; frozen: number }> {
  return request('/gateway-api/balance', {}, env)
}
