import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import { getDeposit, saveDeposit } from './store/index.js'
import { settlePaidDeposit } from './deposit.service.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'

const TONCENTER_BASE = 'https://toncenter.com/api/v2'
export const TON_PENDING_SET = 'tma:ton:pending_orders'
export const TON_ORDER_TTL_MS = 60 * 60 * 1000 // 1 hour

interface TonTransaction {
  transaction_id: { hash: string; lt: string }
  in_msg: { source: string; value: string }
  utime: number
}

export async function fetchRecentTonTransactions(
  merchantAddress: string,
  apiKey: string,
  limit = 50,
): Promise<TonTransaction[]> {
  const url = `${TONCENTER_BASE}/getTransactions?address=${encodeURIComponent(merchantAddress)}&limit=${limit}&archival=false`
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (apiKey) headers['X-API-Key'] = apiKey

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`TonCenter HTTP ${res.status}`)
  const json = (await res.json()) as { ok: boolean; result?: TonTransaction[] }
  if (!json.ok) throw new Error('TonCenter returned ok=false')
  return json.result ?? []
}

export async function pollAndSettleTonDeposits(redis: Redis, env: Env): Promise<void> {
  const orderIds = await redis.smembers(TON_PENDING_SET)
  if (!orderIds.length) return

  let txs: TonTransaction[] = []
  try {
    txs = await fetchRecentTonTransactions(env.MERCHANT_TON_ADDRESS, env.TONCENTER_API_KEY)
  } catch (err) {
    console.error('[ton-poller] fetch error:', err)
    return
  }

  for (const orderId of orderIds) {
    try {
      await checkAndSettleOrder(redis, env, orderId, txs)
    } catch (err) {
      console.error(`[ton-poller] error for ${orderId}:`, err)
    }
  }
}

async function checkAndSettleOrder(
  redis: Redis,
  env: Env,
  orderId: string,
  txs: TonTransaction[],
): Promise<void> {
  const order = await getDeposit(redis, orderId)
  if (!order) {
    await redis.srem(TON_PENDING_SET, orderId)
    return
  }
  if (order.status !== 'pending') {
    await redis.srem(TON_PENDING_SET, orderId)
    return
  }

  const params = order.tonConnectParams
  if (!params) {
    await redis.srem(TON_PENDING_SET, orderId)
    return
  }

  if (Date.now() > Number(params.expiresAt)) {
    order.status = 'cancelled'
    await saveDeposit(redis, order)
    await redis.srem(TON_PENDING_SET, orderId)
    return
  }

  const expectedNano = BigInt(params.amountNano)
  const userAddr = params.userWalletAddress.toLowerCase()

  const matchedTx = txs.find((tx) => {
    if (!tx.in_msg?.source) return false
    const sender = tx.in_msg.source.toLowerCase()
    if (sender !== userAddr) return false
    const received = BigInt(tx.in_msg.value ?? '0')
    // Accept within ±2% tolerance
    const diff = received > expectedNano ? received - expectedNano : expectedNano - received
    return diff * 100n <= expectedNano * 2n
  })

  if (!matchedTx) return

  order.tonConnectParams = { ...params, txHash: matchedTx.transaction_id.hash }
  await settlePaidDeposit(redis, order, {
    usdtToPhpRate: env.USDT_TO_PHP_RATE,
    tonToPhpRate: env.TON_TO_PHP_RATE,
    amountPhpUnits: order.amount,
    currency: order.currency as 'TON',
    mysqlPool: isMysqlEnabled(env) ? getMysqlPool(env) : undefined,
  })
  await redis.srem(TON_PENDING_SET, orderId)
  console.log(`[ton-poller] settled ${orderId} tx=${matchedTx.transaction_id.hash}`)
}
