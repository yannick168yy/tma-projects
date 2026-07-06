import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../../config/env.js'
import { getMysqlPool } from '../../clients/mysql.client.js'

// 存款/提现查询走确定性直查,不经 LLM。state 三态供前端上色
export type OrderState = 'success' | 'pending' | 'failed'
export type OrderKind = 'deposit' | 'withdraw'

export interface CsOrder {
  orderId: string
  amount: string
  currency: string
  channel: string
  status: string
  state: OrderState
  createdAt: string
  settledAt: string | null
  rejectReason: string | null
}

const FAILED_STATUSES = new Set(['failed', 'rejected', 'admin_rejected'])

function iso(v: unknown): string | null {
  return v ? new Date(v as Date).toISOString() : null
}

export async function queryRecentOrders(env: Env, userId: string, kind: OrderKind): Promise<CsOrder[]> {
  const pool = getMysqlPool(env)

  if (kind === 'deposit') {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT order_id, amount, currency, channel, status, credited, created_at, updated_at
       FROM bg_deposit_order WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
      [userId],
    )
    return rows.map((r) => {
      const credited = Number(r.credited) === 1
      const state: OrderState = credited ? 'success' : FAILED_STATUSES.has(r.status) ? 'failed' : 'pending'
      return {
        orderId: r.order_id,
        amount: Number(r.amount).toFixed(2),
        currency: r.currency,
        channel: r.channel,
        status: r.status,
        state,
        createdAt: iso(r.created_at)!,
        // 到账时间:已到账用 updated_at 近似(credited 置 1 时更新)
        settledAt: credited ? iso(r.updated_at) : null,
        rejectReason: null,
      }
    })
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT order_id, amount, currency, channel, status, created_at, handled_at, reject_reason
     FROM bg_withdraw_order WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
    [userId],
  )
  return rows.map((r) => {
    const state: OrderState =
      r.status === 'completed' ? 'success' : FAILED_STATUSES.has(r.status) ? 'failed' : 'pending'
    return {
      orderId: r.order_id,
      amount: Number(r.amount).toFixed(2),
      currency: r.currency,
      channel: r.channel,
      status: r.status,
      state,
      createdAt: iso(r.created_at)!,
      settledAt: iso(r.handled_at),
      rejectReason: r.reject_reason ?? null,
    }
  })
}
