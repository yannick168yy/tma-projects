import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../../config/env.js'
import { getMysqlPool } from '../../clients/mysql.client.js'

export type PaymentOrderType = 'deposit' | 'withdrawal'

export interface PaymentOrder {
  id?: number
  userId: string
  provider: string
  type: PaymentOrderType
  merchantSerial: string
  platformId?: string
  amountCents: number
  channelCode?: string
  optionCode?: string
  targetAccount?: string
  targetOwner?: string
  state: number
  payUrl?: string
  extraParams?: string
  notifyAt?: string
  createdAt?: string
  updatedAt?: string
}

type OrderRow = RowDataPacket & {
  id: number
  user_id: string
  provider: string
  type: string
  merchant_serial: string
  platform_id: string | null
  amount_cents: number
  channel_code: string | null
  option_code: string | null
  target_account: string | null
  target_owner: string | null
  state: number
  pay_url: string | null
  extra_params: string | null
  notify_at: string | null
  created_at: string
  updated_at: string
}

function rowToOrder(r: OrderRow): PaymentOrder {
  return {
    id: r.id,
    userId: r.user_id,
    provider: r.provider,
    type: r.type as PaymentOrderType,
    merchantSerial: r.merchant_serial,
    platformId: r.platform_id ?? undefined,
    amountCents: Number(r.amount_cents),
    channelCode: r.channel_code ?? undefined,
    optionCode: r.option_code ?? undefined,
    targetAccount: r.target_account ?? undefined,
    targetOwner: r.target_owner ?? undefined,
    state: r.state,
    payUrl: r.pay_url ?? undefined,
    extraParams: r.extra_params ?? undefined,
    notifyAt: r.notify_at ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export async function savePaymentOrder(env: Env, order: PaymentOrder): Promise<void> {
  await getMysqlPool(env).execute(
    `INSERT INTO bg_payment_order
      (user_id, provider, type, merchant_serial, platform_id, amount_cents, channel_code,
       option_code, target_account, target_owner, state, pay_url, extra_params)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      order.userId, order.provider, order.type, order.merchantSerial,
      order.platformId ?? null, order.amountCents, order.channelCode ?? null,
      order.optionCode ?? null, order.targetAccount ?? null, order.targetOwner ?? null,
      order.state, order.payUrl ?? null, order.extraParams ?? null,
    ],
  )
}

export async function getPaymentOrderBySerial(env: Env, merchantSerial: string): Promise<PaymentOrder | null> {
  const [rows] = await getMysqlPool(env).query<OrderRow[]>(
    `SELECT * FROM bg_payment_order WHERE merchant_serial = ? LIMIT 1`,
    [merchantSerial],
  )
  return rows[0] ? rowToOrder(rows[0]) : null
}

export async function updatePaymentOrderState(
  env: Env,
  merchantSerial: string,
  state: number,
  platformId?: string,
): Promise<void> {
  await getMysqlPool(env).execute(
    `UPDATE bg_payment_order SET state = ?, platform_id = COALESCE(?, platform_id), notify_at = NOW() WHERE merchant_serial = ?`,
    [state, platformId ?? null, merchantSerial],
  )
}

export async function listPaymentOrders(
  env: Env,
  userId: string,
  type: PaymentOrderType,
  limit = 20,
): Promise<PaymentOrder[]> {
  const [rows] = await getMysqlPool(env).query<OrderRow[]>(
    `SELECT * FROM bg_payment_order WHERE user_id = ? AND type = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, type, limit],
  )
  return rows.map(rowToOrder)
}
