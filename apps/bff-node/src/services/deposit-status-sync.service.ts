import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import type { OrderDeposit } from '../types/domain.js'
import { getMysqlPool } from '../clients/mysql.client.js'
import { queryDeposit as yfpayQueryDeposit } from './yfpay.service.js'
import { queryDeposit as beepayQueryDeposit } from './beepay.service.js'
import { queryDeposit as unispayQueryDeposit, type UnispayOrderQueryResult } from './unispay.service.js'

const QUERY_AFTER_MINUTES = 30
const FORCE_FAIL_AFTER_MINUTES = 120
const SCAN_LIMIT = 50

type DepositProvider = 'yfpay' | 'beepay' | 'unispay'

interface PendingDepositRow extends RowDataPacket {
  order_id: string
  user_id: string
  amount: number
  currency: OrderDeposit['currency']
  channel: string
  status: OrderDeposit['status']
  created_at: Date
  extra: string | Record<string, unknown> | null
}

export interface DepositSyncResult {
  orderId: string
  provider: DepositProvider
  state: number
  status: OrderDeposit['status']
  changed: boolean
}

export interface DepositStatusTickResult {
  checked: number
  paid: number
  failed: number
  timedOut: number
  errors: number
}

function resolveProvider(order: Pick<OrderDeposit, 'provider' | 'channelId'>): DepositProvider | null {
  const raw = String(order.provider || order.channelId || '').toLowerCase()
  if (raw.includes('yfpay')) return 'yfpay'
  if (raw.includes('beepay')) return 'beepay'
  if (raw.includes('unispay')) return 'unispay'
  return null
}

function mapStateToStatus(provider: DepositProvider, state: number): OrderDeposit['status'] | null {
  if (provider === 'unispay') {
    if (state === 1) return 'paid'
    if (state === 2 || state === 3) return 'failed'
    return null
  }
  if (state === 2) return 'paid'
  if (state === 3) return 'failed'
  return null
}

async function queryProviderState(env: Env, provider: DepositProvider, orderId: string): Promise<{ state: number; unispay?: UnispayOrderQueryResult }> {
  if (provider === 'beepay') return { state: (await beepayQueryDeposit(orderId, env)).state }
  if (provider === 'unispay') {
    const result = await unispayQueryDeposit(orderId, env)
    return { state: result.state, unispay: result }
  }
  return { state: (await yfpayQueryDeposit(orderId, env)).state }
}

function extraPatch(reason: string, state?: number): Record<string, unknown> {
  return {
    depositStatusSync: {
      reason,
      providerState: state ?? null,
      syncedAt: new Date().toISOString(),
    },
  }
}

async function markDepositFailed(env: Env, orderId: string, reason: string, state?: number): Promise<boolean> {
  const [res] = await getMysqlPool(env).execute<import('mysql2/promise').ResultSetHeader>(
    `UPDATE bg_deposit_order
     SET status = 'failed',
         extra = JSON_MERGE_PATCH(COALESCE(extra,'{}'), ?)
     WHERE order_id = ? AND status = 'pending'`,
    [JSON.stringify(extraPatch(reason, state)), orderId],
  )
  return res.affectedRows > 0
}

async function settleDepositViaCore(env: Env, provider: DepositProvider, order: OrderDeposit, unispay?: UnispayOrderQueryResult): Promise<boolean> {
  const res = await fetch(`${env.CORE_NODE_URL}/internal/payment/${provider}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': env.INTERNAL_TOKEN,
    },
    body: JSON.stringify({
      orderId: order.orderId,
      userId: order.userId,
      creditedCents: order.amount,
      ...(provider === 'unispay' ? {
        providerOrderId: unispay?.platformId,
        status: String(unispay?.state ?? 0),
        amount: unispay?.amount || order.amount,
      } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`core payment sync failed: ${res.status}`)
  return true
}

export async function syncQueriedDepositStatus(env: Env, order: OrderDeposit): Promise<DepositSyncResult | null> {
  if (order.status !== 'pending') return null
  const provider = resolveProvider(order)
  if (!provider) return null

  const queried = await queryProviderState(env, provider, order.orderId)
  const state = queried.state
  const status = mapStateToStatus(provider, state)
  if (!status) return { orderId: order.orderId, provider, state, status: 'pending', changed: false }

  if (status === 'failed') {
    const changed = await markDepositFailed(env, order.orderId, 'provider_failed', state)
    return { orderId: order.orderId, provider, state, status: 'failed', changed }
  }

  await settleDepositViaCore(env, provider, order, queried.unispay)
  return { orderId: order.orderId, provider, state, status: 'paid', changed: true }
}

function mapRow(row: PendingDepositRow): OrderDeposit {
  let extra: Record<string, unknown> | undefined
  try {
    extra = row.extra
      ? (typeof row.extra === 'string' ? JSON.parse(row.extra) : row.extra)
      : undefined
  } catch {
    extra = undefined
  }
  return {
    orderId: String(row.order_id),
    userId: String(row.user_id),
    amount: Number(row.amount),
    currency: row.currency,
    channelId: String(row.channel),
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    extraData: extra,
  }
}

export async function runDepositStatusTick(env: Env, log: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void }): Promise<DepositStatusTickResult> {
  const [rows] = await getMysqlPool(env).query<PendingDepositRow[]>(
    `SELECT order_id, user_id, amount, currency, channel, status, created_at, extra
     FROM bg_deposit_order
     WHERE status = 'pending'
       AND (channel LIKE 'yfpay\\_%' OR channel LIKE 'beepay\\_%')
       AND created_at < NOW() - INTERVAL ? MINUTE
     ORDER BY created_at ASC
     LIMIT ?`,
    [QUERY_AFTER_MINUTES, SCAN_LIMIT],
  )

  const out: DepositStatusTickResult = { checked: 0, paid: 0, failed: 0, timedOut: 0, errors: 0 }
  const now = Date.now()
  for (const row of rows) {
    const order = mapRow(row)
    const ageMinutes = (now - new Date(row.created_at).getTime()) / 60000
    out.checked += 1
    try {
      const result = await syncQueriedDepositStatus(env, order)
      if (result?.status === 'paid') out.paid += 1
      if (result?.status === 'failed') out.failed += 1
      if (result?.status === 'pending' && ageMinutes >= FORCE_FAIL_AFTER_MINUTES) {
        if (await markDepositFailed(env, order.orderId, 'timeout', result.state)) {
          out.failed += 1
          out.timedOut += 1
        }
      }
    } catch (err) {
      out.errors += 1
      if (ageMinutes >= FORCE_FAIL_AFTER_MINUTES) {
        try {
          if (await markDepositFailed(env, order.orderId, 'timeout_query_error')) {
            out.failed += 1
            out.timedOut += 1
          }
        } catch (markErr) {
          log.warn({ err: markErr, orderId: order.orderId }, 'deposit timeout mark failed')
        }
      } else {
        log.warn({ err, orderId: order.orderId }, 'deposit status sync failed')
      }
    }
  }
  if (out.checked > 0) log.info(out, 'deposit status tick done')
  return out
}
