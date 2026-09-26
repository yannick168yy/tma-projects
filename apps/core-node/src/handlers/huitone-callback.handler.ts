import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { Redis } from 'ioredis'
import { lgId } from '../utils/id.js'
import { createDepositRequirement } from '../services/turnover.service.js'
import { applyDepositPromos } from '../services/deposit-promo.service.js'
import { tryActivateTeamNode } from '../services/team-activation.service.js'

export interface HuitoneCallbackPayload {
  completionTime: string
  event: 'PAYIN' | 'PAYOUT'
  extInfo: string
  outTradeNo: string
  sign?: string
  transAmt: string
  transNo: string
  transStatus: 'SUCCESS' | 'FAIL'
  utr: string
  [key: string]: unknown
}

export async function recordHuitoneIssue(
  db: Pool,
  issueType: string,
  payload: Partial<HuitoneCallbackPayload>,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db.execute(
    `INSERT INTO bg_payment_callback_issue
       (provider, issue_type, order_id, provider_order_id, status_value, detail)
     VALUES ('huitone', ?, ?, ?, ?, ?)`,
    [issueType, payload.outTradeNo ?? null, payload.transNo ?? null, payload.transStatus ?? null, JSON.stringify(detail)],
  ).catch(() => {})
}

export async function handleHuitoneCallback(
  payload: HuitoneCallbackPayload,
  db: Pool,
  redis: Redis,
): Promise<void> {
  const { event, outTradeNo, transNo, transStatus, transAmt } = payload
  const idempotencyKey = `huitone:cb:${transNo}:${transStatus}`
  const locked = await redis.set(idempotencyKey, '1', 'EX', 604800, 'NX')
  if (!locked) return

  try {
    const processed = event === 'PAYIN'
      ? await handleDeposit(payload, db)
      : await handleWithdraw(payload, db)
    if (!processed) await redis.del(idempotencyKey).catch(() => {})
  } catch (err) {
    await recordHuitoneIssue(db, 'processing_error', payload, {
      error: err instanceof Error ? err.message : String(err),
      callbackAmount: transAmt,
      orderId: outTradeNo,
    })
    await redis.del(idempotencyKey).catch(() => {})
    throw err
  }
}

async function handleDeposit(payload: HuitoneCallbackPayload, db: Pool): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT order_id, user_id, currency, amount, credited, status FROM bg_deposit_order WHERE order_id = ? LIMIT 1`,
    [payload.outTradeNo],
  )
  const order = rows[0]
  if (!order) throw new Error(`Huitone 存款订单不存在: ${payload.outTradeNo}`)
  if (Math.abs(Number(payload.transAmt) - Number(order.amount)) > 0.01) {
    await recordHuitoneIssue(db, 'amount_mismatch', payload, {
      localAmount: Number(order.amount), callbackAmount: Number(payload.transAmt),
    })
    return false
  }
  if (order.status === 'paid') return true

  if (payload.transStatus === 'SUCCESS') {
    const creditAmount = Number(order.amount)
    const currency = String(order.currency ?? 'INR')
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      const [mark] = await conn.execute<import('mysql2/promise').ResultSetHeader>(
        `UPDATE bg_deposit_order
         SET status='paid', credited=1,
             extra=JSON_SET(COALESCE(extra,'{}'),'$.providerRef',?,'$.utr',?,'$.completionTime',?)
         WHERE order_id=? AND credited=0`,
        [payload.transNo, payload.utr, payload.completionTime, payload.outTradeNo],
      )
      if (mark.affectedRows === 0) {
        await conn.rollback()
        return true
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
        [lgId(), order.user_id, currency, creditAmount, balanceAfter, payload.outTradeNo, `Huitone 充值 #${payload.outTradeNo}`],
      )
      await createDepositRequirement(conn, order.user_id, payload.outTradeNo, creditAmount, currency)
      await tryActivateTeamNode(conn, String(order.user_id), creditAmount, currency)
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
    await applyDepositPromos(db, {
      orderId: payload.outTradeNo,
      userId: String(order.user_id),
      amount: creditAmount,
      currency,
    }, { error: (obj, msg) => console.error(`[huitone-callback] ${msg}`, obj) })
  } else {
    await db.execute(
      `UPDATE bg_deposit_order
       SET status='rejected', extra=JSON_SET(COALESCE(extra,'{}'),'$.providerRef',?,'$.utr',?,'$.completionTime',?)
       WHERE order_id=? AND status='pending'`,
      [payload.transNo, payload.utr, payload.completionTime, payload.outTradeNo],
    )
  }
  return true
}

async function handleWithdraw(payload: HuitoneCallbackPayload, db: Pool): Promise<boolean> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT order_id, user_id, currency, amount, status, refunded FROM bg_withdraw_order WHERE order_id = ? LIMIT 1`,
    [payload.outTradeNo],
  )
  const order = rows[0]
  if (!order) throw new Error(`Huitone 提现订单不存在: ${payload.outTradeNo}`)
  if (Math.abs(Number(payload.transAmt) - Number(order.amount)) > 0.01) {
    await recordHuitoneIssue(db, 'amount_mismatch', payload, {
      localAmount: Number(order.amount), callbackAmount: Number(payload.transAmt),
    })
    return false
  }
  if (order.status === 'completed' || order.status === 'rejected' || order.status === 'failed') return true

  if (payload.transStatus === 'SUCCESS') {
    await db.execute(
      `UPDATE bg_withdraw_order
       SET status='completed',
           extra=JSON_SET(COALESCE(extra,'{}'),'$.providerRef',?,'$.utr',?,'$.completionTime',?,'$.completedAt',NOW())
       WHERE order_id=?`,
      [payload.transNo, payload.utr, payload.completionTime, payload.outTradeNo],
    )
    return true
  }

  if (!order.refunded) {
    const refundAmount = Number(order.amount)
    const currency = String(order.currency ?? 'INR')
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      const [mark] = await conn.execute<import('mysql2/promise').ResultSetHeader>(
        `UPDATE bg_withdraw_order
         SET status='failed', refunded=1,
             reject_reason=COALESCE(reject_reason,'渠道打款失败，已自动退款'),
             extra=JSON_SET(COALESCE(extra,'{}'),'$.providerRef',?,'$.utr',?,'$.completionTime',?)
         WHERE order_id=? AND refunded=0 AND status NOT IN ('completed','rejected','failed')`,
        [payload.transNo, payload.utr, payload.completionTime, payload.outTradeNo],
      )
      if (mark.affectedRows === 0) {
        await conn.rollback()
        return true
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
          `REFUND_${payload.outTradeNo}`, `Huitone 提现退款 #${payload.outTradeNo}`],
      )
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
  }
  return true
}
