/**
 * BeePay 支付服务预留桩
 * API 文档到手后在此实现，接口签名与 yfpay.service.ts 保持对称
 */
import type { Env } from '../config/env.js'

// TODO: 接入 BeePay 后补充真实 BASE_URL
const _BASE_URL = 'https://api.beepay.example.com'

export class BeepayError extends Error {
  constructor(public readonly code: number, message: string) {
    super(`BeePay error ${code}: ${message}`)
  }
}

export interface BeepayDepositChannel {
  code: string
  name: string
  min: number
  max: number
}

export interface BeepayDepositResult {
  platformId: string
  merchantSerial: string
  amount: number
  state: number
  payUrl: string
}

export interface BeepayWithdrawalResult {
  platformId: string
  merchantSerial: string
  amount: number
  state: number
}

// TODO: 实现真实代收渠道查询
export async function getDepositChannels(_env: Env): Promise<BeepayDepositChannel[]> {
  throw new BeepayError(501, 'BeePay 尚未接入，请等待 API 文档')
}

// TODO: 实现真实代收下单
export async function createDeposit(
  _params: { amount: number; channelCode: string; merchantSerial: string; notifyUrl: string },
  _env: Env,
): Promise<BeepayDepositResult> {
  throw new BeepayError(501, 'BeePay 尚未接入，请等待 API 文档')
}

// TODO: 实现真实代收查单
export async function queryDeposit(
  _merchantSerial: string,
  _env: Env,
): Promise<{ state: number }> {
  throw new BeepayError(501, 'BeePay 尚未接入，请等待 API 文档')
}

// TODO: 实现真实代付出款
export async function createWithdrawal(
  _params: { merchantSerial: string; amount: number; targetOwner: string; targetAccount: string; channelCode: string; notifyUrl: string },
  _env: Env,
): Promise<BeepayWithdrawalResult> {
  throw new BeepayError(501, 'BeePay 尚未接入，请等待 API 文档')
}

// TODO: 实现真实代付查单
export async function queryWithdrawal(
  _merchantSerial: string,
  _env: Env,
): Promise<{ state: number }> {
  throw new BeepayError(501, 'BeePay 尚未接入，请等待 API 文档')
}
