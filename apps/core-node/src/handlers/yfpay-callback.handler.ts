import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { Redis } from 'ioredis'
import { lgId } from '../utils/id.js'

export interface YfPayCallbackPayload {
  merchantSerial: string
  platformId: string
  state: number
  amount: number
  [key: string]: unknown
}

/**
 * YF Pay 充值/提现回调处理（从 NATS betogo.callback 消费）
 * merchantSerial 前缀：YFD_ = 代收，YFW_ = 代付
 */
export async function handleYfPayCallback(
  payload: YfPayCallbackPayload,
  db: Pool,
  redis: Redis,
): Promise<void> {
  const { merchantSerial, platformId, state, amount } = payload

  // 幂等：同一平台订单号只处理一次（7天）
  const idempotencyKey = `yfpay:cb:${platformId}`
  const locked = await redis.set(idempotencyKey, '1', 'EX', 604800, 'NX')
  if (!locked) return

  const isDeposit = merchantSerial.startsWith('YFD')

  if (isDeposit) {
    await handleDeposit(merchantSerial, platformId, state, amount, db)
  } else {
    await handleWithdraw(merchantSerial, platformId, state, db)
  }
}

async function handleDeposit(
  merchantSerial: string,
  platformId: string,
  state: number,
  amount: number,
  db: Pool,
): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT order_id, user_id, amount, credited_cents, status FROM bg_order_deposit WHERE order_id = ? LIMIT 1`,
    [merchantSerial],
  )
  const order = rows[0]
  if (!order) return
  if (order.status === 'paid') return // 已入账，幂等跳过

  if (state === 2) {
    // 完成：入账
    const creditAmount = Number(order.credited_cents ?? order.amount)
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      await conn.execute(
        `UPDATE bg_wallet SET available = available + ?, version = version + 1 WHERE user_id = ?`,
        [creditAmount, order.user_id],
      )
      const [[wallet]] = await conn.query<RowDataPacket[]>(
        `SELECT available FROM bg_wallet WHERE user_id = ?`,
        [order.user_id],
      )
      const balanceAfter = Number(wallet?.available ?? 0)
      await conn.execute(
        `INSERT INTO bg_wallet_ledger (id, user_id, type, amount, balance_after, ref_type, ref_id, description)
         VALUES (?, ?, 'deposit', ?, ?, 'deposit', ?, ?)`,
        [lgId(), order.user_id, creditAmount, balanceAfter, merchantSerial, `YF Pay 充值 #${merchantSerial}`],
      )
      const paidAt = new Date()
      await conn.execute(
        `UPDATE bg_order_deposit SET status='paid', provider_ref=?, paid_at=? WHERE order_id=?`,
        [platformId, paidAt, merchantSerial],
      )
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
  } else if (state === 3) {
    // 失败
    await db.execute(
      `UPDATE bg_order_deposit SET status='rejected', provider_ref=? WHERE order_id=?`,
      [platformId, merchantSerial],
    )
  }
}

async function handleWithdraw(
  merchantSerial: string,
  platformId: string,
  state: number,
  db: Pool,
): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT order_id, user_id, amount, status FROM bg_order_withdraw WHERE order_id = ? LIMIT 1`,
    [merchantSerial],
  )
  const order = rows[0]
  if (!order) return
  if (order.status === 'completed' || order.status === 'rejected') return

  if (state === 1) {
    // 出款完成
    await db.execute(
      `UPDATE bg_order_withdraw SET status='completed', provider_ref=?, completed_at=NOW() WHERE order_id=?`,
      [platformId, merchantSerial],
    )
  } else if (state === 2 || state === 3) {
    // 驳回：退款
    const refundAmount = Number(order.amount)
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      await conn.execute(
        `UPDATE bg_wallet SET available = available + ?, version = version + 1 WHERE user_id = ?`,
        [refundAmount, order.user_id],
      )
      const [[wallet]] = await conn.query<RowDataPacket[]>(
        `SELECT available FROM bg_wallet WHERE user_id = ?`,
        [order.user_id],
      )
      const balanceAfter = Number(wallet?.available ?? 0)
      await conn.execute(
        `INSERT INTO bg_wallet_ledger (id, user_id, type, amount, balance_after, ref_type, ref_id, description)
         VALUES (?, ?, 'adjust', ?, ?, 'withdraw', ?, ?)`,
        [lgId(), order.user_id, refundAmount, balanceAfter, `REFUND_${merchantSerial}`, `YF Pay 提现退款 #${merchantSerial}`],
      )
      await conn.execute(
        `UPDATE bg_order_withdraw SET status='rejected', provider_ref=?, completed_at=NOW() WHERE order_id=?`,
        [platformId, merchantSerial],
      )
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
  }
}
