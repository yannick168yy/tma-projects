import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { Redis } from 'ioredis'
import { lgId } from '../utils/id.js'

export interface BeepayCallbackPayload {
  channelOrderNo: string
  tradeNo: string
  midNo: string
  amount: number
  status: number // 0待付 / 1已付 / 2失败
  [key: string]: unknown
}

export async function handleBeepayCallback(
  payload: BeepayCallbackPayload,
  db: Pool,
  redis: Redis,
): Promise<void> {
  const { channelOrderNo, tradeNo, status, amount } = payload

  const idempotencyKey = `beepay:cb:${channelOrderNo}`
  const locked = await redis.set(idempotencyKey, '1', 'EX', 604800, 'NX')
  if (!locked) return

  const isDeposit = tradeNo.startsWith('BPD')
  if (isDeposit) {
    await handleDeposit(tradeNo, channelOrderNo, status, amount, db)
  } else {
    await handleWithdraw(tradeNo, channelOrderNo, status, db)
  }
}

async function handleDeposit(
  merchantSerial: string,
  channelOrderNo: string,
  status: number,
  amount: number,
  db: Pool,
): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT order_id, user_id, currency, amount, credited, status FROM bg_deposit_order WHERE order_id = ? LIMIT 1`,
    [merchantSerial],
  )
  const order = rows[0]
  if (!order || order.status === 'paid') return

  if (status === 1) {
    // credited 是 0/1 入账标志位（非金额），实际充值额在 amount 列
    const creditAmount = Number(order.amount)
    const currency: string = order.currency ?? 'PHP'
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
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
        [lgId(), order.user_id, currency, creditAmount, balanceAfter, merchantSerial, `BeePay 充值 #${merchantSerial}`],
      )
      await conn.execute(
        `UPDATE bg_deposit_order SET status='paid', extra=JSON_SET(COALESCE(extra,'{}'),'$.providerRef',?) WHERE order_id=?`,
        [channelOrderNo, merchantSerial],
      )
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
  } else if (status === 2) {
    await db.execute(
      `UPDATE bg_deposit_order SET status='rejected', extra=JSON_SET(COALESCE(extra,'{}'),'$.providerRef',?) WHERE order_id=?`,
      [channelOrderNo, merchantSerial],
    )
  }
}

async function handleWithdraw(
  merchantSerial: string,
  channelOrderNo: string,
  status: number,
  db: Pool,
): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT order_id, user_id, currency, amount, status FROM bg_withdraw_order WHERE order_id = ? LIMIT 1`,
    [merchantSerial],
  )
  const order = rows[0]
  if (!order || order.status === 'completed' || order.status === 'rejected') return

  if (status === 1) {
    await db.execute(
      `UPDATE bg_withdraw_order SET status='completed', extra=JSON_SET(COALESCE(extra,'{}'),'$.providerRef',?,'$.completedAt',NOW()) WHERE order_id=?`,
      [channelOrderNo, merchantSerial],
    )
  } else if (status === 2) {
    const refundAmount = Number(order.amount)
    const currency: string = order.currency ?? 'PHP'
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
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
          `REFUND_${merchantSerial}`, `BeePay 提现退款 #${merchantSerial}`],
      )
      await conn.execute(
        `UPDATE bg_withdraw_order SET status='rejected', extra=JSON_SET(COALESCE(extra,'{}'),'$.providerRef',?) WHERE order_id=?`,
        [channelOrderNo, merchantSerial],
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
