import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { Redis } from 'ioredis'
import { lgId } from '../utils/id.js'
import { createDepositRequirement } from '../services/turnover.service.js'
import { applyDepositPromos } from '../services/deposit-promo.service.js'
import { tryActivateTeamNode } from '../routes/internal.routes.js'

export interface UnispayCallbackPayload {
  amount: string
  mchNo: string
  mchOrderId: string
  orderNo: string
  status: string
  [key: string]: unknown
}

export async function handleUnispayCallback(
  payload: UnispayCallbackPayload,
  db: Pool,
  redis: Redis,
): Promise<void> {
  const { mchOrderId, orderNo, status } = payload
  const idempotencyKey = `unispay:cb:${orderNo}:${status}`
  const locked = await redis.set(idempotencyKey, '1', 'EX', 604800, 'NX')
  if (!locked) return

  try {
    if (mchOrderId.startsWith('UPD')) {
      await handleDeposit(mchOrderId, orderNo, status, db)
    } else {
      await handleWithdraw(mchOrderId, orderNo, status, db)
    }
  } catch (err) {
    await redis.del(idempotencyKey).catch(() => {})
    throw err
  }
}

async function handleDeposit(
  merchantSerial: string,
  platformId: string,
  status: string,
  db: Pool,
): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT order_id, user_id, currency, amount, credited, status FROM bg_deposit_order WHERE order_id = ? LIMIT 1`,
    [merchantSerial],
  )
  const order = rows[0]
  if (!order || order.status === 'paid') return

  if (status === '1') {
    const creditAmount = Number(order.amount)
    const currency: string = order.currency ?? 'IDR'
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      const [mark] = await conn.execute<import('mysql2/promise').ResultSetHeader>(
        `UPDATE bg_deposit_order SET status='paid', credited=1, extra=JSON_SET(COALESCE(extra,'{}'),'$.providerRef',?) WHERE order_id=? AND credited=0`,
        [platformId, merchantSerial],
      )
      if (mark.affectedRows === 0) {
        await conn.rollback()
        return
      }
      await conn.execute(
        `INSERT INTO bg_wallet (user_id, currency, available, version)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE available = available + ?, version = version + 1`,
        [order.user_id, currency, creditAmount, creditAmount],
      )
      const [[wallet]] = await conn.query<RowDataPacket[]>(
        `SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ?`,
        [order.user_id, currency],
      )
      const balanceAfter = Number(wallet?.available ?? 0)
      await conn.execute(
        `INSERT INTO bg_wallet_ledger (id, user_id, currency, type, amount, balance_after, ref_type, ref_id, description)
         VALUES (?, ?, ?, 'deposit', ?, ?, 'deposit', ?, ?)`,
        [lgId(), order.user_id, currency, creditAmount, balanceAfter, merchantSerial, `UnisPay 充值 #${merchantSerial}`],
      )
      await createDepositRequirement(conn, order.user_id, merchantSerial, creditAmount, currency)
      await tryActivateTeamNode(conn, String(order.user_id), creditAmount)
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
    await applyDepositPromos(db, {
      orderId: merchantSerial,
      userId: String(order.user_id),
      amount: creditAmount,
      currency,
    }, { error: (obj, msg) => console.error(`[unispay-callback] ${msg}`, obj) })
  } else if (status === '2' || status === '3') {
    await db.execute(
      `UPDATE bg_deposit_order SET status='rejected', extra=JSON_SET(COALESCE(extra,'{}'),'$.providerRef',?) WHERE order_id=?`,
      [platformId, merchantSerial],
    )
  }
}

async function handleWithdraw(
  merchantSerial: string,
  platformId: string,
  status: string,
  db: Pool,
): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT order_id, user_id, currency, amount, status, refunded FROM bg_withdraw_order WHERE order_id = ? LIMIT 1`,
    [merchantSerial],
  )
  const order = rows[0]
  if (!order || order.status === 'completed' || order.status === 'rejected' || order.status === 'failed') return

  if (status === '2') {
    await db.execute(
      `UPDATE bg_withdraw_order SET status='completed', extra=JSON_SET(COALESCE(extra,'{}'),'$.providerRef',?,'$.completedAt',NOW()) WHERE order_id=?`,
      [platformId, merchantSerial],
    )
  } else if ((status === '3' || status === '4') && !order.refunded) {
    const refundAmount = Number(order.amount)
    const currency: string = order.currency ?? 'IDR'
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      const [mark] = await conn.execute<import('mysql2/promise').ResultSetHeader>(
        `UPDATE bg_withdraw_order
           SET status='failed', refunded=1,
               reject_reason=COALESCE(reject_reason,'渠道打款失败，已自动退款'),
               extra=JSON_SET(COALESCE(extra,'{}'),'$.providerRef',?)
         WHERE order_id=? AND refunded=0 AND status NOT IN ('completed','rejected','failed')`,
        [platformId, merchantSerial],
      )
      if (mark.affectedRows === 0) {
        await conn.rollback()
        return
      }
      await conn.execute(
        `INSERT INTO bg_wallet (user_id, currency, available, version)
         VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE available = available + ?, version = version + 1`,
        [order.user_id, currency, refundAmount, refundAmount],
      )
      const [[wallet]] = await conn.query<RowDataPacket[]>(
        `SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ?`,
        [order.user_id, currency],
      )
      const balanceAfter = Number(wallet?.available ?? 0)
      await conn.execute(
        `INSERT INTO bg_wallet_ledger (id, user_id, currency, type, amount, balance_after, ref_type, ref_id, description)
         VALUES (?, ?, ?, 'adjust', ?, ?, 'withdraw', ?, ?)`,
        [lgId(), order.user_id, currency, refundAmount, balanceAfter,
          `REFUND_${merchantSerial}`, `UnisPay 提现退款 #${merchantSerial}`],
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
