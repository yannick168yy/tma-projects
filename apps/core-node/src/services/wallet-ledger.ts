/**
 * 聚合商无关的钱包记账原语。
 *
 * 抽这一层是因为第二家聚合商（WXGame，无缝钱包）要接进来，而两家在协议层差别极大
 * （幂等键形状、作废语义、开号方式、对账能力），唯独「锁余额 → 改余额 → 记流水 →
 * 刷新局汇总」这几步是逐字相同的。抽的是这几步，**不是** provider 接口 ——
 * 只有一个实现时设计的接口会把这一家的假设焊死，理由见
 * docs/architecture/06-aggregator-integration.md。
 *
 * 因此这里只放不含任何厂商语义的 SQL：入参是 userId + currency，不是某家的 player 对象。
 */
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import { lgId } from '../utils/id.js'

export interface LedgerAccount {
  userId: string
  currency: string
}

interface WalletRow extends RowDataPacket {
  available: string | number
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function isDupEntry(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: string }).code === 'ER_DUP_ENTRY'
}

export async function ensureWallet(conn: PoolConnection, acct: LedgerAccount): Promise<void> {
  await conn.execute(
    `INSERT IGNORE INTO bg_wallet (user_id, currency, available, frozen, version)
     VALUES (?, ?, 0, 0, 0)`,
    [acct.userId, acct.currency],
  )
}

export async function currentBalance(conn: PoolConnection, acct: LedgerAccount): Promise<number> {
  const [[wallet]] = await conn.query<WalletRow[]>(
    `SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ?`,
    [acct.userId, acct.currency],
  )
  return Number(wallet?.available ?? 0)
}

export async function lockedBalance(conn: PoolConnection, acct: LedgerAccount): Promise<number> {
  await ensureWallet(conn, acct)
  const [[wallet]] = await conn.query<WalletRow[]>(
    `SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ? FOR UPDATE`,
    [acct.userId, acct.currency],
  )
  return Number(wallet?.available ?? 0)
}

export async function changeBalance(conn: PoolConnection, acct: LedgerAccount, amount: number): Promise<number> {
  await conn.execute(
    `UPDATE bg_wallet SET available = ROUND(available + ?, 2), version = version + 1 WHERE user_id = ? AND currency = ?`,
    [round2(amount), acct.userId, acct.currency],
  )
  return currentBalance(conn, acct)
}

export async function addLedger(
  conn: PoolConnection,
  acct: LedgerAccount,
  type: string,
  amount: number,
  balanceAfter: number,
  refId: string,
  description: string,
): Promise<void> {
  await conn.execute(
    `INSERT INTO bg_wallet_ledger (id, user_id, currency, type, amount, balance_after, ref_type, ref_id, description)
     VALUES (?, ?, ?, ?, ?, ?, 'game', ?, ?)`,
    [lgId(), acct.userId, acct.currency, type, round2(amount), round2(balanceAfter), refId, description],
  )
}

// 按 round_id 从 bg_bet_order 重算该局汇总，写入 bg_bet_round(读加速表)。
// 派生数据：恒等于旧 /bets 分组结果；一局仅几行、走 (user_id, round_id) 索引，成本极低。
// aggregator_id 取自 bg_bet_order，本身就跨聚合商，无需分流。
export async function refreshBetRound(conn: PoolConnection, userId: string, roundId: string): Promise<void> {
  if (!roundId) return
  await conn.execute(
    `INSERT INTO bg_bet_round (user_id, round_id, aggregator_id, provider_txn_id, bet_amount, win_amount, currency_code, first_at, last_id)
     SELECT user_id, round_id, MAX(aggregator_id),
       COALESCE(MAX(CASE WHEN bet_type = 'bet' THEN provider_txn_id END), MAX(provider_txn_id)),
       SUM(CASE WHEN bet_type = 'bet' THEN amount ELSE 0 END),
       SUM(CASE WHEN bet_type IN ('win', 'refund') THEN amount ELSE 0 END),
       MAX(currency_code), MIN(created_at), MAX(id)
     FROM bg_bet_order WHERE user_id = ? AND round_id = ? GROUP BY user_id, round_id
     ON DUPLICATE KEY UPDATE
       aggregator_id = VALUES(aggregator_id), provider_txn_id = VALUES(provider_txn_id),
       bet_amount = VALUES(bet_amount), win_amount = VALUES(win_amount),
       currency_code = VALUES(currency_code), first_at = VALUES(first_at), last_id = VALUES(last_id)`,
    [userId, roundId],
  )
}
