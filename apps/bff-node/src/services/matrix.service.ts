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

// ── 提现（出站调 Matrix API）─────────────────────────────────────────────────

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

  await pool.query(
    `INSERT INTO bg_matrix_withdraw_order
       (merchant_order_no, user_id, symbol, chain, amount, amount_php,
        to_address, status, local_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pending')`,
    [merchantOrderNo, opts.userId, opts.symbol, opts.chain,
      opts.cryptoAmount, opts.phpAmount, opts.toAddress],
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
      'UPDATE bg_matrix_withdraw_order SET order_no=?, status=? WHERE merchant_order_no=?',
      [matrixOrderNo, resp.status, merchantOrderNo],
    )
  } catch (err) {
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
