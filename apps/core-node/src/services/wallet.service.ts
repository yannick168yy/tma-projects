import type { FastifyInstance } from 'fastify'
import { ATOMIC_BALANCE_UPDATE, IDEMPOTENCY_LOCK } from '../utils/lua-scripts.js'

export type LedgerType = 'deposit' | 'withdraw' | 'bet' | 'win' | 'bonus' | 'red_packet' | 'adjust'

export interface LedgerEntry {
  userId: number
  type: LedgerType
  amountCents: number  // 正数=入账，负数=出账
  refId: string        // 外部单号，用于幂等
  note?: string
}

export class WalletService {
  constructor(private app: FastifyInstance) {}

  async applyLedger(entry: LedgerEntry): Promise<{ newBalance: number }> {
    const { userId, type, amountCents, refId, note } = entry
    const redis = this.app.redis
    const db = this.app.mysql

    // 幂等检查（7天）
    const locked = await redis.eval(IDEMPOTENCY_LOCK, 1, `idempotency:${refId}`, 604800)
    if (locked === 0) {
      throw new Error(`DUPLICATE_REF_ID:${refId}`)
    }

    // 原子余额更新
    const walletKey = `wallet:${userId}:available`
    const newBalance = await redis.eval(
      ATOMIC_BALANCE_UPDATE, 1, walletKey, amountCents, 0
    ) as number

    // 写账变流水（MySQL）
    await db.execute(
      `INSERT INTO bg_wallet_ledger (user_id, type, amount_cents, ref_id, note, created_at)
       VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [userId, type, amountCents, refId, note ?? null]
    )

    return { newBalance }
  }

  async getBalance(userId: number): Promise<number> {
    const key = `wallet:${userId}:available`
    const val = await this.app.redis.get(key)
    return val ? parseInt(val, 10) : 0
  }
}
