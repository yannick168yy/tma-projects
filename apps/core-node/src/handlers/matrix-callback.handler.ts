import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { Redis } from 'ioredis'
import { lgId } from '../utils/id.js'

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
  usdtToPhpRate: number,
): Promise<void> {
  if (notify.notifyType === 1) {
    await handleMatrixDeposit(notify as MatrixDepositNotify, rawJson, db, usdtToPhpRate)
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
  usdtToPhpRate: number,
): Promise<void> {
  // 幂等：已入账则跳过
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT id, credited FROM bg_matrix_deposit_order WHERE order_no = ? LIMIT 1`,
    [notify.orderNo],
  )
  const existing = rows[0] as { id: number; credited: number } | undefined
  if (existing?.credited) return

  // upsert 订单记录
  const matrixStatus = notify.notifyStatus === 1 ? 1 : notify.notifyStatus === 2 ? 3 : 4
  await db.query(
    `INSERT INTO bg_matrix_deposit_order
       (order_no, user_id, symbol, chain, amount, from_address, to_address, tx_hash,
        status, on_chain_time, finish_time, notify_raw)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       status = VALUES(status),
       tx_hash = COALESCE(VALUES(tx_hash), tx_hash),
       on_chain_time = COALESCE(VALUES(on_chain_time), on_chain_time),
       finish_time = COALESCE(VALUES(finish_time), finish_time),
       notify_raw = VALUES(notify_raw),
       updated_at = NOW()`,
    [
      notify.orderNo, notify.userId, notify.symbol, notify.chain,
      notify.amount, notify.fromAddress ?? null, notify.toAddress,
      notify.hash ?? null, matrixStatus,
      notify.onChainTime ?? null, notify.finishTime ?? null, rawJson,
    ],
  )

  // notifyStatus=2 才入账
  if (notify.notifyStatus !== 2) return

  const creditedPhp = convertToPHP(notify.symbol, Number(notify.amount), usdtToPhpRate)
  if (creditedPhp <= 0) return

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.execute(
      `UPDATE bg_wallet SET available = available + ?, version = version + 1 WHERE user_id = ?`,
      [creditedPhp, notify.userId],
    )
    const [[wallet]] = await conn.query<RowDataPacket[]>(
      `SELECT available FROM bg_wallet WHERE user_id = ?`,
      [notify.userId],
    )
    const balanceAfter = Number(wallet?.available ?? 0)
    await conn.execute(
      `INSERT INTO bg_wallet_ledger (id, user_id, type, amount, balance_after, ref_type, ref_id, description)
       VALUES (?, ?, 'deposit', ?, ?, 'deposit', ?, ?)`,
      [lgId(), notify.userId, creditedPhp, balanceAfter, notify.orderNo,
        `Matrix ${notify.symbol} 充值 (≈ ₱${creditedPhp.toFixed(2)})`],
    )
    await conn.execute(
      `UPDATE bg_matrix_deposit_order SET credited = 1, credited_php = ? WHERE order_no = ?`,
      [creditedPhp, notify.orderNo],
    )
    await conn.commit()
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
    `SELECT id, amount_php, local_status, refunded FROM bg_matrix_withdraw_order
     WHERE merchant_order_no = ? LIMIT 1`,
    [notify.merchantOrderNo],
  )
  const order = rows[0] as { id: number; amount_php: number; local_status: string; refunded: number } | undefined
  if (!order || order.local_status === 'completed') return

  await db.query(
    `UPDATE bg_matrix_withdraw_order SET
       order_no = COALESCE(order_no, ?),
       tx_hash = COALESCE(?, tx_hash),
       on_chain_time = COALESCE(?, on_chain_time),
       finish_time = COALESCE(?, finish_time),
       notify_raw = ?,
       updated_at = NOW()
     WHERE merchant_order_no = ?`,
    [
      notify.orderNo ?? null, notify.hash ?? null,
      notify.onChainTime ?? null, notify.finishTime ?? null,
      rawJson, notify.merchantOrderNo,
    ],
  )

  if (notify.notifyStatus === 2) {
    await db.execute(
      `UPDATE bg_matrix_withdraw_order SET local_status='completed', status=5 WHERE merchant_order_no=?`,
      [notify.merchantOrderNo],
    )
  } else if (notify.notifyStatus === 3 && !order.refunded) {
    const refundAmount = Number(order.amount_php)
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      await conn.execute(
        `UPDATE bg_wallet SET available = available + ?, version = version + 1 WHERE user_id = ?`,
        [refundAmount, notify.userId],
      )
      const [[wallet]] = await conn.query<RowDataPacket[]>(
        `SELECT available FROM bg_wallet WHERE user_id = ?`,
        [notify.userId],
      )
      const balanceAfter = Number(wallet?.available ?? 0)
      await conn.execute(
        `INSERT INTO bg_wallet_ledger (id, user_id, type, amount, balance_after, ref_type, ref_id, description)
         VALUES (?, ?, 'adjust', ?, ?, 'withdraw', ?, ?)`,
        [lgId(), notify.userId, refundAmount, balanceAfter,
          `MXREFUND_${notify.merchantOrderNo}`, `Matrix 提现失败退款 #${notify.merchantOrderNo}`],
      )
      await conn.execute(
        `UPDATE bg_matrix_withdraw_order SET local_status='failed', status=6, refunded=1 WHERE merchant_order_no=?`,
        [notify.merchantOrderNo],
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

function convertToPHP(symbol: string, amount: number, usdtToPhpRate: number): number {
  if (symbol === 'USDT') return Math.round(amount * usdtToPhpRate * 100) / 100
  // Matrix 测试环境币种：1:1 映射到 USDT 汇率（测试用）
  if (symbol === 'TRON_SHASTA' || symbol === 'TRX_TESTNET') return Math.round(amount * usdtToPhpRate * 100) / 100
  return 0
}
