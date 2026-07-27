import type { Pool, RowDataPacket } from 'mysql2/promise'

export const MIN_CRYPTO_REAL_DEPOSIT = 5

export async function hasRealDepositForWithdraw(pool: Pool, userId: string): Promise<boolean> {
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT EXISTS(
       SELECT 1
       FROM bg_deposit_order
       WHERE user_id = ?
         AND status = 'paid'
         AND amount > 0
         AND (
           UPPER(currency) NOT IN ('USDT', 'USDC')
           OR amount >= ?
         )
       LIMIT 1
     ) AS ok`,
    [userId, MIN_CRYPTO_REAL_DEPOSIT],
  )
  return Number(row?.ok ?? 0) === 1
}
