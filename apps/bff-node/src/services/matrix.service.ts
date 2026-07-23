import type { RowDataPacket } from 'mysql2/promise'
import type { Env } from '../config/env.js'
import { getMysqlPool } from '../clients/mysql.client.js'
import { getMatrixClient, MatrixApiError, isMatrixEnabled } from '../clients/matrix.client.js'
import { creditWallet } from './store/index.js'
import { randomOrderId } from '../utils/id.js'
import { nowIso } from '../utils/format.js'
import type { Redis } from 'ioredis'

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

  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT address FROM bg_matrix_deposit_address WHERE user_id=? AND symbol=? AND chain=? LIMIT 1',
    [userId, symbol, chain],
  )
  if (rows[0]) {
    return { address: rows[0].address as string, symbol, chain }
  }

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

// ── 提现 Step 1：存单（仅写 DB，不调 Matrix API）────────────────────────────
// 用于用户提交提现申请时，等待后台审批

export function generateMerchantOrderNo(): string {
  return randomOrderId('MXW')
}

export async function initMatrixWithdrawOrder(
  env: Env,
  opts: {
    merchantOrderNo: string
    userId: string
    toAddress: string
    symbol: string
    chain: string
    payoutAmount: string
    gasFee?: number
  },
): Promise<void> {
  const pool = getMysqlPool(env)
  const gasFee = opts.gasFee ?? 0
  // amount = 钱包实扣总额；extra.cryptoAmount = 扣除 gas 后的链上实际到账额。
  await pool.query(
    `INSERT INTO bg_withdraw_order
       (order_id, user_id, channel, currency, amount, status, to_address, chain, extra)
     VALUES (?, ?, 'matrix', ?, ?, 'pending', ?, ?,
       JSON_OBJECT('cryptoAmount', ?, 'gasFee', ?))`,
    [
      opts.merchantOrderNo, opts.userId, opts.symbol,
      Number(opts.payoutAmount) + gasFee, opts.toAddress, opts.chain,
      opts.payoutAmount, gasFee,
    ],
  )
}

// ── 提现 Step 2：后台批准时调 Matrix API 实际出款 ─────────────────────────────

export async function executeMatrixWithdrawOrder(
  env: Env,
  redis: Redis,
  merchantOrderNo: string,
): Promise<string> {
  const pool = getMysqlPool(env)

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT order_id, user_id, currency, amount, to_address, chain,
            JSON_UNQUOTE(JSON_EXTRACT(extra, '$.cryptoAmount')) AS payout_amount
     FROM bg_withdraw_order WHERE order_id = ? LIMIT 1`,
    [merchantOrderNo],
  )
  const order = rows[0]
  if (!order) throw new Error(`Order not found: ${merchantOrderNo}`)

  const client = matrixClientFromEnv(env)
  // 链上实际出款额 = extra.cryptoAmount（不含 gas）；老单无 extra.cryptoAmount 时回退 amount
  const payoutAmount = order.payout_amount != null ? String(order.payout_amount) : String(order.amount)

  try {
    const resp = await client.createWithdrawOrder({
      merchantOrderNo,
      userId: String(order.user_id),
      toAddress: String(order.to_address),
      symbol: String(order.currency),
      chain: String(order.chain),
      amount: payoutAmount,
    })
    await pool.query(
      `UPDATE bg_withdraw_order
         SET status='processing',
             extra=JSON_SET(COALESCE(extra,'{}'),'$.matrixOrderNo',?)
       WHERE order_id=?`,
      [resp.orderNo, merchantOrderNo],
    )
    return resp.orderNo
  } catch (err) {
    await pool.query(
      `UPDATE bg_withdraw_order SET status='failed', refunded=1 WHERE order_id=?`,
      [merchantOrderNo],
    )
    await creditWallet(redis, String(order.user_id), Number(order.amount), {
      type: 'deposit',
      refId: merchantOrderNo,
      description: `Matrix 提现出款失败退款 #${merchantOrderNo}`,
      createdAt: nowIso(),
      currency: String(order.currency),
    })
    const msg = err instanceof MatrixApiError ? err.message : 'Matrix 提现出款失败'
    throw new Error(msg)
  }
}
