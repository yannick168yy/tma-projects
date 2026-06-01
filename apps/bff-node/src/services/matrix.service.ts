import type { Pool, RowDataPacket } from 'mysql2/promise'
import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import { getMysqlPool } from '../clients/mysql.client.js'
import { getMatrixClient, MatrixApiError, isMatrixEnabled } from '../clients/matrix.client.js'
import { creditWallet } from './store/index.js'
import { randomOrderId } from '../utils/id.js'
import { nowIso } from '../utils/format.js'

// ── PEM 换行处理 ──────────────────────────────────────────────────────────────
// 环境变量中 \n 为字面字符串，需还原为真实换行符
function normalizePem(pem: string): string {
  return pem.replace(/\\n/g, '\n')
}

// ── Matrix 客户端工厂 ─────────────────────────────────────────────────────────

export function matrixClientFromEnv(env: Env) {
  if (!isMatrixEnabled(env)) {
    throw new Error('Matrix payment channel is not configured')
  }
  return getMatrixClient({
    gatewayUrl: env.MATRIX_GATEWAY_URL,
    apiKey: env.MATRIX_API_KEY,
    merchantApiPrivKeyPem: normalizePem(env.MATRIX_MERCHANT_API_PRIVATE_KEY),
    platformApiPubKeyPem: normalizePem(env.MATRIX_PLATFORM_API_PUBLIC_KEY),
  })
}

export function matrixNotifyKeysFromEnv(env: Env): {
  merchantNotifyPrivKeyPem: string
  platformNotifyPubKeyPem: string
} {
  return {
    merchantNotifyPrivKeyPem: normalizePem(env.MATRIX_MERCHANT_NOTIFY_PRIVATE_KEY),
    platformNotifyPubKeyPem: normalizePem(env.MATRIX_PLATFORM_NOTIFY_PUBLIC_KEY),
  }
}

// ── 充值地址 ──────────────────────────────────────────────────────────────────

export interface MatrixDepositAddress {
  address: string
  symbol: string
  chain: string
}

export async function getOrFetchDepositAddress(
  env: Env,
  userId: string,
  symbol: string,
  chain: string,
): Promise<MatrixDepositAddress> {
  const pool = getMysqlPool(env)

  // 优先查缓存
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT address FROM bg_matrix_deposit_address WHERE user_id=? AND symbol=? AND chain=? LIMIT 1',
    [userId, symbol, chain],
  )
  if (rows[0]) {
    return { address: rows[0].address as string, symbol, chain }
  }

  // 调 Matrix API
  const client = matrixClientFromEnv(env)
  const resp = await client.getDepositAddress({ userId, symbol, chain })

  await pool.query(
    `INSERT INTO bg_matrix_deposit_address (user_id, symbol, chain, address)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE address = VALUES(address), updated_at = NOW()`,
    [userId, symbol, chain, resp.address],
  )

  return { address: resp.address, symbol: resp.symbol, chain: resp.chain }
}

// 地址变更通知：更新本地缓存
export async function updateDepositAddress(
  pool: Pool,
  userId: string,
  symbol: string,
  chain: string,
  newAddress: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO bg_matrix_deposit_address (user_id, symbol, chain, address)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE address = VALUES(address), updated_at = NOW()`,
    [userId, symbol, chain, newAddress],
  )
}

// ── 充值通知处理 ──────────────────────────────────────────────────────────────

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

/**
 * 处理充值通知（notifyStatus=2 成功时入账，幂等）。
 * 返回是否已入账（方便调试日志）。
 */
export async function handleDepositNotify(
  env: Env,
  redis: Redis,
  notify: MatrixDepositNotify,
  rawJson: string,
): Promise<boolean> {
  const pool = getMysqlPool(env)

  // 幂等：检查是否已入账
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, credited FROM bg_matrix_deposit_order WHERE order_no=? LIMIT 1',
    [notify.orderNo],
  )
  const existing = rows[0] as { id: number; credited: number } | undefined

  if (existing?.credited) {
    return false // 已入账，忽略
  }

  const status = notify.notifyStatus
  // upsert 订单记录
  await pool.query(
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
      notify.orderNo,
      notify.userId,
      notify.symbol,
      notify.chain,
      notify.amount,
      notify.fromAddress ?? null,
      notify.toAddress,
      notify.hash ?? null,
      mapDepositNotifyStatus(status),
      notify.onChainTime ?? null,
      notify.finishTime ?? null,
      rawJson,
    ],
  )

  // 只有 notifyStatus=2（链上成功/已收款，等同文档 status=2/3）才入账
  if (status !== 2) {
    return false
  }

  // 折算入账金额（PHP，用配置汇率）
  const creditedPhp = convertToPHP(notify.symbol, Number(notify.amount), env)
  if (creditedPhp <= 0) return false

  await creditWallet(redis, notify.userId, creditedPhp, {
    type: 'deposit',
    refId: notify.orderNo,
    description: `Matrix ${notify.symbol} 充值 (≈ ₱${creditedPhp.toFixed(2)})`,
    createdAt: nowIso(),
  })

  await pool.query(
    'UPDATE bg_matrix_deposit_order SET credited=1, credited_php=? WHERE order_no=?',
    [creditedPhp, notify.orderNo],
  )

  return true
}

// ── 提现 ──────────────────────────────────────────────────────────────────────

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

/**
 * 创建 Matrix 提现订单。
 * 调用前调用方应已扣除余额并写入本地 OrderWithdraw 记录。
 * 若 Matrix API 报错，本函数负责退款并标记失败。
 */
export async function createMatrixWithdraw(
  env: Env,
  redis: Redis,
  opts: {
    userId: string
    toAddress: string
    symbol: string
    chain: string
    cryptoAmount: string
    phpAmount: number
  },
): Promise<{ merchantOrderNo: string; matrixOrderNo: string }> {
  const merchantOrderNo = randomOrderId('MXW')
  const pool = getMysqlPool(env)

  // 先写本地记录（status=pending）
  await pool.query(
    `INSERT INTO bg_matrix_withdraw_order
       (merchant_order_no, user_id, symbol, chain, amount, amount_php,
        to_address, status, local_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pending')`,
    [
      merchantOrderNo,
      opts.userId,
      opts.symbol,
      opts.chain,
      opts.cryptoAmount,
      opts.phpAmount,
      opts.toAddress,
    ],
  )

  let matrixOrderNo: string
  try {
    const client = matrixClientFromEnv(env)
    const resp = await client.createWithdrawOrder({
      merchantOrderNo,
      userId: opts.userId,
      toAddress: opts.toAddress,
      symbol: opts.symbol,
      chain: opts.chain,
      amount: opts.cryptoAmount,
    })
    matrixOrderNo = resp.orderNo

    await pool.query(
      "UPDATE bg_matrix_withdraw_order SET order_no=?, status=? WHERE merchant_order_no=?",
      [matrixOrderNo, resp.status, merchantOrderNo],
    )
  } catch (err) {
    // Matrix API 创建失败 → 退款 + 标记失败
    await pool.query(
      "UPDATE bg_matrix_withdraw_order SET local_status='failed', refunded=1 WHERE merchant_order_no=?",
      [merchantOrderNo],
    )
    await creditWallet(redis, opts.userId, opts.phpAmount, {
      type: 'deposit',
      refId: merchantOrderNo,
      description: `Matrix 提现创建失败退款 #${merchantOrderNo}`,
      createdAt: nowIso(),
    })
    const msg = err instanceof MatrixApiError ? err.message : 'Matrix 提现创建失败'
    throw new Error(msg)
  }

  return { merchantOrderNo, matrixOrderNo }
}

/**
 * 处理提现状态通知（幂等）。
 * notifyStatus=2 成功：标记 completed。
 * notifyStatus=3 失败：退款。
 */
export async function handleWithdrawNotify(
  env: Env,
  redis: Redis,
  notify: MatrixWithdrawNotify,
  rawJson: string,
): Promise<void> {
  const pool = getMysqlPool(env)

  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT id, amount_php, local_status, refunded FROM bg_matrix_withdraw_order WHERE merchant_order_no=? LIMIT 1',
    [notify.merchantOrderNo],
  )
  const order = rows[0] as {
    id: number
    amount_php: number
    local_status: string
    refunded: number
  } | undefined

  if (!order || order.local_status === 'completed') return

  const matrixStatus = notify.notifyStatus

  await pool.query(
    `UPDATE bg_matrix_withdraw_order SET
       order_no = COALESCE(order_no, ?),
       tx_hash = COALESCE(?, tx_hash),
       on_chain_time = COALESCE(?, on_chain_time),
       finish_time = COALESCE(?, finish_time),
       notify_raw = ?,
       updated_at = NOW()
     WHERE merchant_order_no = ?`,
    [
      notify.orderNo ?? null,
      notify.hash ?? null,
      notify.onChainTime ?? null,
      notify.finishTime ?? null,
      rawJson,
      notify.merchantOrderNo,
    ],
  )

  if (matrixStatus === 2) {
    await pool.query(
      "UPDATE bg_matrix_withdraw_order SET local_status='completed', status=5 WHERE merchant_order_no=?",
      [notify.merchantOrderNo],
    )
  } else if (matrixStatus === 3 && !order.refunded) {
    // 失败退款
    await pool.query(
      "UPDATE bg_matrix_withdraw_order SET local_status='failed', status=6, refunded=1 WHERE merchant_order_no=?",
      [notify.merchantOrderNo],
    )
    await creditWallet(redis, notify.userId, order.amount_php, {
      type: 'deposit',
      refId: notify.merchantOrderNo,
      description: `Matrix 提现失败退款 #${notify.merchantOrderNo}`,
      createdAt: nowIso(),
    })
  }
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function mapDepositNotifyStatus(notifyStatus: number): number {
  // notifyStatus 1=已上链 2=成功 3=失败 → 映射到 deposit_order.status
  if (notifyStatus === 1) return 1
  if (notifyStatus === 2) return 3
  if (notifyStatus === 3) return 4
  return 0
}

function convertToPHP(symbol: string, amount: number, env: Env): number {
  if (symbol === 'USDT') {
    return Math.round(amount * env.USDT_TO_PHP_RATE * 100) / 100
  }
  // 其他币种暂不支持，返回 0 阻止入账
  return 0
}
