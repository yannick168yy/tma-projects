import { buildRequest, parseResponse, type MatrixEnvelope } from '../utils/matrix-crypto.js'

export interface MatrixClientConfig {
  gatewayUrl: string
  apiKey: string
  merchantApiPrivKeyPem: string
  platformApiPubKeyPem: string
}

export interface DepositAddressReq {
  userId: string
  symbol: string
  chain: string
}

export interface DepositAddressResp {
  address: string
  symbol: string
  chain: string
}

export interface DepositOrderResp {
  orderNo: string
  fromAddress: string | null
  toAddress: string
  symbol: string
  chain: string
  amount: number
  hash: string | null
  status: number
  createTime: number
  onChainTime: number | null
  finishTime: number | null
}

export interface DepositPageReq {
  pageNo: number
  pageSize: number
  status?: number
  hashList?: string[]
  createTimeStart?: number
  createTimeEnd?: number
}

export interface PageResp<T> {
  total: number
  list: T[]
}

export interface WithdrawCreateReq {
  merchantOrderNo: string
  userId: string
  toAddress: string
  symbol: string
  chain: string
  amount: string
}

export interface WithdrawCreateResp {
  orderNo: string
  merchantOrderNo: string
  symbol: string
  chain: string
  amount: number
  status: number
}

export interface WithdrawOrderResp {
  orderNo: string
  merchantOrderNo: string
  fromAddress: string | null
  toAddress: string
  symbol: string
  chain: string
  amount: number
  hash: string | null
  status: number
  createTime: number
  onChainTime: number | null
  finishTime: number | null
}

export interface WithdrawPageReq {
  pageNo: number
  pageSize: number
  status?: number
  createTimeStart?: number
  createTimeEnd?: number
  finishTimeStart?: number
  finishTimeEnd?: number
}

export class MatrixApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(`Matrix API error ${code}: ${message}`)
    this.name = 'MatrixApiError'
  }
}

export class MatrixClient {
  constructor(private readonly cfg: MatrixClientConfig) {}

  private async call<T>(path: string, bizData: unknown): Promise<T> {
    const envelope = buildRequest(
      bizData,
      this.cfg.apiKey,
      this.cfg.merchantApiPrivKeyPem,
      this.cfg.platformApiPubKeyPem,
    )

    const url = `${this.cfg.gatewayUrl}${path}`
    console.log('[Matrix] →', url, '| biz:', JSON.stringify(bizData))

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(envelope),
    })

    const json = (await res.json()) as { code: number; msg: string } & Partial<MatrixEnvelope>
    console.log('[Matrix] ←', JSON.stringify(json))

    if (json.code !== 0) {
      throw new MatrixApiError(json.code, json.msg)
    }

    return parseResponse<T>(
      json as MatrixEnvelope,
      this.cfg.platformApiPubKeyPem,
      this.cfg.merchantApiPrivKeyPem,
    )
  }

  getDepositAddress(req: DepositAddressReq): Promise<DepositAddressResp> {
    return this.call('/deposit/address', req)
  }

  queryDepositOrder(orderNo: string): Promise<DepositOrderResp> {
    return this.call('/deposit/order/query', { orderNo })
  }

  pageDepositOrders(req: DepositPageReq): Promise<PageResp<DepositOrderResp & { merchantNo: string }>> {
    return this.call('/deposit/order/page', req)
  }

  createWithdrawOrder(req: WithdrawCreateReq): Promise<WithdrawCreateResp> {
    return this.call('/withdraw/order/create', req)
  }

  queryWithdrawOrder(opts: { orderNo?: string; merchantOrderNo?: string }): Promise<WithdrawOrderResp> {
    return this.call('/withdraw/order/query', opts)
  }

  pageWithdrawOrders(req: WithdrawPageReq): Promise<PageResp<WithdrawOrderResp & { merchantNo: string }>> {
    return this.call('/withdraw/order/page', req)
  }
}

let _client: MatrixClient | null = null

export function getMatrixClient(cfg: MatrixClientConfig): MatrixClient {
  if (!_client) {
    _client = new MatrixClient(cfg)
  }
  return _client
}

export function isMatrixEnabled(env: {
  MATRIX_GATEWAY_URL: string
  MATRIX_API_KEY: string
  MATRIX_MERCHANT_API_PRIVATE_KEY: string
  MATRIX_PLATFORM_API_PUBLIC_KEY: string
}): boolean {
  return Boolean(
    env.MATRIX_GATEWAY_URL &&
      env.MATRIX_API_KEY &&
      env.MATRIX_MERCHANT_API_PRIVATE_KEY &&
      env.MATRIX_PLATFORM_API_PUBLIC_KEY,
  )
}
