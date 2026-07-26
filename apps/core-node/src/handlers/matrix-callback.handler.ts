import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { Redis } from 'ioredis'
import { lgId } from '../utils/id.js'
import { createDepositRequirement } from '../services/turnover.service.js'
import { tryActivateTeamNode } from '../routes/internal.routes.js'
import { getPhpRate } from '../services/exchange-rate.service.js'
import { applyDepositPromos } from '../services/deposit-promo.service.js'

export interface MatrixDepositNotify {
  notifyType: 1
  merchantNo: string
  orderNo: string
  symbol: string
  chain: string
  amount: number
  hash: string
  notifyStatus: 1 | 2 | 3
  userId: string
  fromAddress: string
  toAddress: string
  onChainTime?: number
  finishTime?: number
}

export interface MatrixWithdrawNotify {
  notifyType: 2
  merchantNo: string
  orderNo: string
  merchantOrderNo: string
  symbol: string
  chain: string
  amount: number
  hash: string
  notifyStatus: 1 | 2 | 3
  userId: string
  fromAddress: string
  toAddress: string
  onChainTime?: number
  finishTime?: number
}

export interface MatrixAddressChangeNotify {
  notifyType: 3
  merchantNo: string
  userId: string
  oldAddress: string
  newAddress: string
  symbol: string
  chain: string
  changeTime: number
}

export type MatrixNotify = MatrixDepositNotify | MatrixWithdrawNotify | MatrixAddressChangeNotify

export async function handleMatrixCallback(
  notify: MatrixNotify,
  rawJson: string,
  db: Pool,
  redis: Redis,
  _usdtToPhpRate: number,
): Promise<void> {
  if (notify.notifyType === 1) {
    await handleMatrixDeposit(notify as MatrixDepositNotify, rawJson, db)
  } else if (notify.notifyType === 2) {
    await handleMatrixWithdraw(notify as MatrixWithdrawNotify, rawJson, db)
  } else if (notify.notifyType === 3) {
    await handleMatrixAddressChange(notify as MatrixAddressChangeNotify, db)
  }
}

async function handleMatrixDeposit(
  notify: MatrixDepositNotify,
  rawJson: string,
  db: Pool,
): Promise<void> {
  const status = notify.notifyStatus === 2 ? 'paid' : notify.notifyStatus === 3 ? 'failed' : 'pending'

  // upsert 订单（order_id = Matrix orderNo）
  await db.query(
    `INSERT INTO bg_deposit_order
       (order_id, user_id, channel, currency, amount, status, credited,
        tx_hash, from_address, to_address, chain, extra)
     VALUES (?, ?, 'matrix', ?, ?, ?, 0, ?, ?, ?, ?,
       JSON_OBJECT('notifyRaw', ?, 'onChainTime', ?, 'finishTime', ?))
     ON DUPLICATE KEY UPDATE
       status     = VALUES(status),
       tx_hash    = COALESCE(VALUES(tx_hash), tx_hash),
       extra      = VALUES(extra),
       updated_at = NOW()`,
    [
      notify.orderNo, notify.userId, notify.symbol, Number(notify.amount), status,
      notify.hash ?? null, notify.fromAddress ?? null, notify.toAddress,
      notify.chain, rawJson, notify.onChainTime ?? null, notify.finishTime ?? null,
    ],
  )

  // notifyStatus=2 且未入账才入账
  if (notify.notifyStatus !== 2) return

  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT credited FROM bg_deposit_order WHERE order_id = ? LIMIT 1`,
    [notify.orderNo],
  )
  if (rows[0]?.credited) return

  const currency = notify.symbol  // 原始币种（TRX / USDT / TRX_TESTNET 等）
  const amount = Number(notify.amount)

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    // credited=0 条件是重复/并发回调的最终闸门：只有一个事务能标记成功（上面的预检不在事务内，挡不住并发）
    const [mark] = await conn.execute<import('mysql2/promise').ResultSetHeader>(
      `UPDATE bg_deposit_order SET credited = 1, status = 'paid' WHERE order_id = ? AND credited = 0`,
      [notify.orderNo],
    )
    if (mark.affectedRows === 0) {
      await conn.rollback()
      return
    }
    // upsert 钱包行（该币种）
    await conn.execute(
      `INSERT INTO bg_wallet (user_id, currency, available, version)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE available = available + ?, version = version + 1`,
      [notify.userId, currency, amount, amount],
    )
    const [[wallet]] = await conn.query<RowDataPacket[]>(
      `SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ?`,
      [notify.userId, currency],
    )
    const balanceAfter = Number(wallet?.available ?? 0)
    await conn.execute(
      `INSERT INTO bg_wallet_ledger
         (id, user_id, currency, type, amount, balance_after, ref_type, ref_id, description)
       VALUES (?, ?, ?, 'deposit', ?, ?, 'deposit', ?, ?)`,
      [lgId(), notify.userId, currency, amount, balanceAfter, notify.orderNo,
        `Matrix ${notify.symbol} 充值 ${amount}`],
    )
    await createDepositRequirement(conn, notify.userId, notify.orderNo, amount, notify.symbol)
    const phpRate = await getPhpRate(notify.symbol)
    const phpCents = Math.floor(amount * phpRate * 100)
    await tryActivateTeamNode(conn, notify.userId, phpCents)
    await conn.commit()
    await applyDepositPromos(db, {
      orderId: notify.orderNo,
      userId: notify.userId,
      amount,
      currency,
    }, { error: (obj, msg) => console.error(`[matrix-callback] ${msg}`, obj) })
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

async function handleMatrixWithdraw(
  notify: MatrixWithdrawNotify,
  rawJson: string,
  db: Pool,
): Promise<void> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT order_id, user_id, currency, amount, status, refunded,
            JSON_UNQUOTE(JSON_EXTRACT(extra, '$.cryptoAmount')) AS crypto_amount
     FROM bg_withdraw_order WHERE order_id = ? LIMIT 1`,
    [notify.merchantOrderNo],
  )
  const order = rows[0] as {
    order_id: string; user_id: string; currency: string
    amount: number; status: string; refunded: number
    crypto_amount: string | null
  } | undefined
  if (!order || order.status === 'completed') return

  await db.query(
    `UPDATE bg_withdraw_order SET
       extra      = JSON_MERGE_PATCH(COALESCE(extra,'{}'),
                     JSON_OBJECT('matrixOrderNo',?,'txHash',?,'onChainTime',?,'finishTime',?,'notifyRaw',?)),
       updated_at = NOW()
     WHERE order_id = ?`,
    [notify.orderNo ?? null, notify.hash ?? null,
      notify.onChainTime ?? null, notify.finishTime ?? null, rawJson,
      notify.merchantOrderNo],
  )

  if (notify.notifyStatus === 2) {
    await db.execute(
      `UPDATE bg_withdraw_order SET status = 'completed' WHERE order_id = ?`,
      [notify.merchantOrderNo],
    )
  } else if (notify.notifyStatus === 3 && !order.refunded) {
    const refundAmount = Number(order.amount)
    const currency = order.currency
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      // refunded=0 条件防重复退款（重复回调/并发下只有一个事务能标记成功）
      const [mark] = await conn.execute<import('mysql2/promise').ResultSetHeader>(
        `UPDATE bg_withdraw_order SET status = 'failed', refunded = 1 WHERE order_id = ? AND refunded = 0`,
        [notify.merchantOrderNo],
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
        `INSERT INTO bg_wallet_ledger
           (id, user_id, currency, type, amount, balance_after, ref_type, ref_id, description)
         VALUES (?, ?, ?, 'adjust', ?, ?, 'withdraw', ?, ?)`,
        [lgId(), order.user_id, currency, refundAmount, balanceAfter,
          `MXREFUND_${notify.merchantOrderNo}`, `Matrix 提现失败退款 #${notify.merchantOrderNo}`],
      )
      // 出款失败：把 bff 发起出款时预扣的 Matrix 登记余额加回（链上额 + gas 1.2，与扣减对称）
      const cryptoAmount = order.crypto_amount != null ? Number(order.crypto_amount) : Number(order.amount)
      await conn.execute(
        `UPDATE provider_balance_snapshot
            SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP
          WHERE provider = 'matrix'`,
        [Math.round((cryptoAmount + 1.2) * 100) / 100],
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

async function handleMatrixAddressChange(
  notify: MatrixAddressChangeNotify,
  db: Pool,
): Promise<void> {
  await db.query(
    `INSERT INTO bg_matrix_deposit_address (user_id, symbol, chain, address)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE address = VALUES(address), updated_at = NOW()`,
    [notify.userId, notify.symbol, notify.chain, notify.newAddress],
  )
}
