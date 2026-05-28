import type { FastifyInstance } from 'fastify'
import type { RowDataPacket } from 'mysql2/promise'
import type { Redis } from 'ioredis'

const centsToBalance = (c: number) => Math.round(c) / 100
const txId = () => `SG_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const lgId = () => `LG_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

export interface SgCallbackBody {
  action: string
  player_id: string
  transaction_id?: string
  amount?: string | number
  round_id?: string
  game_uuid?: string
  currency?: string
}

export class SgCallbackService {
  constructor(private app: FastifyInstance) {}

  private get db() { return this.app.mysql }
  private get redis(): Redis { return this.app.redis as unknown as Redis }

  async handle(body: SgCallbackBody, sgCurrency: string): Promise<unknown> {
    const { action, player_id, transaction_id, round_id, game_uuid = '' } = body
    const db = this.db

    // ── balance ───────────────────────────────────────────────────────────────
    if (action === 'balance') {
      const [[row]] = await db.query<RowDataPacket[]>(
        'SELECT available_cents FROM bg_wallet WHERE user_id = ?',
        [player_id],
      )
      if (!row) return { error_code: 'PLAYER_NOT_FOUND', error_description: 'Player not found' }
      return { balance: centsToBalance(Number(row.available_cents)) }
    }

    // ── idempotency ───────────────────────────────────────────────────────────
    if (transaction_id) {
      const [[cached]] = await db.execute<RowDataPacket[]>(
        `SELECT response_snapshot FROM bg_idempotency WHERE idempotency_key = ? AND scope = 'sg_callback'`,
        [transaction_id],
      )
      if (cached) return JSON.parse(cached.response_snapshot as string)
    }

    // 金额换算为 PHP 分
    const originalAmt = parseFloat(String(body.amount ?? 0))
    let amtCents: number
    if (sgCurrency === 'PHP') {
      amtCents = Math.round(originalAmt * 100)
    } else {
      const cached = await this.redis.get(`exchange_rate:${sgCurrency}:PHP`)
      const rate = cached ? (JSON.parse(cached) as { rate: number }).rate : 58
      amtCents = Math.round(originalAmt * rate * 100)
    }

    // ── bet ───────────────────────────────────────────────────────────────────
    if (action === 'bet') {
      const conn = await db.getConnection()
      try {
        await conn.beginTransaction()
        const [[row]] = await conn.query<RowDataPacket[]>(
          'SELECT available_cents FROM bg_wallet WHERE user_id = ? FOR UPDATE',
          [player_id],
        )
        if (!row || Number(row.available_cents) < amtCents) {
          await conn.rollback()
          return { error_code: 'INSUFFICIENT_FUNDS', error_description: 'Insufficient balance' }
        }
        await conn.execute(
          'UPDATE bg_wallet SET available_cents = available_cents - ?, version = version + 1 WHERE user_id = ?',
          [amtCents, player_id],
        )
        const [[after]] = await conn.query<RowDataPacket[]>(
          'SELECT available_cents FROM bg_wallet WHERE user_id = ?',
          [player_id],
        )
        const bal = Number(after?.available_cents ?? 0)
        await conn.execute(
          `INSERT INTO bg_wallet_ledger (id, user_id, type, amount_cents, balance_after, ref_type, ref_id, description)
           VALUES (?, ?, 'bet', ?, ?, 'game', ?, ?)`,
          [lgId(), player_id, -amtCents, bal, round_id ?? null, `${game_uuid} bet`],
        )
        await conn.execute(
          `INSERT INTO bg_bet_order (user_id, aggregator_id, provider_id, provider_txn_id, round_id, bet_type, amount_cents, currency_code, original_amount, status)
           VALUES (?, 'slotegrator', ?, ?, ?, 'bet', ?, ?, ?, 'settled')`,
          [player_id, game_uuid, transaction_id ?? null, round_id ?? null, amtCents, sgCurrency, originalAmt],
        )
        const resp = { balance: centsToBalance(bal), transaction_id: txId() }
        if (transaction_id) {
          await conn.execute(
            `INSERT IGNORE INTO bg_idempotency (idempotency_key, scope, response_snapshot, expires_at)
             VALUES (?, 'sg_callback', ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
            [transaction_id, JSON.stringify(resp)],
          )
        }
        await conn.commit()
        return resp
      } catch (e) {
        await conn.rollback()
        this.app.log.error({ err: e }, '[sg-callback] bet error')
        return { error_code: 'INTERNAL_ERROR', error_description: 'Bet failed' }
      } finally {
        conn.release()
      }
    }

    // ── win / refund ──────────────────────────────────────────────────────────
    if (action === 'win' || action === 'refund') {
      const conn = await db.getConnection()
      try {
        await conn.beginTransaction()
        await conn.execute(
          'UPDATE bg_wallet SET available_cents = available_cents + ?, version = version + 1 WHERE user_id = ?',
          [amtCents, player_id],
        )
        const [[after]] = await conn.query<RowDataPacket[]>(
          'SELECT available_cents FROM bg_wallet WHERE user_id = ?',
          [player_id],
        )
        const bal = Number(after?.available_cents ?? 0)
        const ledgerType = action === 'win' ? 'win' : 'adjust'
        await conn.execute(
          `INSERT INTO bg_wallet_ledger (id, user_id, type, amount_cents, balance_after, ref_type, ref_id, description)
           VALUES (?, ?, ?, ?, ?, 'game', ?, ?)`,
          [lgId(), player_id, ledgerType, amtCents, bal, round_id ?? null, `${game_uuid} ${action}`],
        )
        await conn.execute(
          `INSERT INTO bg_bet_order (user_id, aggregator_id, provider_id, provider_txn_id, round_id, bet_type, amount_cents, currency_code, original_amount, status)
           VALUES (?, 'slotegrator', ?, ?, ?, ?, ?, ?, ?, 'settled')`,
          [player_id, game_uuid, transaction_id ?? null, round_id ?? null, action, amtCents, sgCurrency, originalAmt],
        )
        const resp = { balance: centsToBalance(bal), transaction_id: txId() }
        if (transaction_id) {
          await conn.execute(
            `INSERT IGNORE INTO bg_idempotency (idempotency_key, scope, response_snapshot, expires_at)
             VALUES (?, 'sg_callback', ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
            [transaction_id, JSON.stringify(resp)],
          )
        }
        await conn.commit()
        return resp
      } catch (e) {
        await conn.rollback()
        this.app.log.error({ err: e }, `[sg-callback] ${action} error`)
        return { error_code: 'INTERNAL_ERROR', error_description: `${action} failed` }
      } finally {
        conn.release()
      }
    }

    // ── rollback ──────────────────────────────────────────────────────────────
    if (action === 'rollback') {
      const conn = await db.getConnection()
      try {
        await conn.beginTransaction()
        const [bets] = await conn.execute<RowDataPacket[]>(
          `SELECT provider_txn_id, amount_cents FROM bg_bet_order
           WHERE user_id = ? AND round_id = ? AND bet_type = 'bet' AND aggregator_id = 'slotegrator'`,
          [player_id, round_id ?? ''],
        )
        const refundCents = bets.reduce((s, r) => s + Number(r.amount_cents), 0)
        if (refundCents > 0) {
          await conn.execute(
            'UPDATE bg_wallet SET available_cents = available_cents + ?, version = version + 1 WHERE user_id = ?',
            [refundCents, player_id],
          )
          const [[after]] = await conn.query<RowDataPacket[]>(
            'SELECT available_cents FROM bg_wallet WHERE user_id = ?',
            [player_id],
          )
          const bal = Number(after?.available_cents ?? 0)
          await conn.execute(
            `INSERT INTO bg_wallet_ledger (id, user_id, type, amount_cents, balance_after, ref_type, ref_id, description)
             VALUES (?, ?, 'adjust', ?, ?, 'game', ?, ?)`,
            [lgId(), player_id, refundCents, bal, round_id ?? null, `${game_uuid} rollback`],
          )
          const resp = {
            balance: centsToBalance(bal),
            transaction_id: txId(),
            rollback_transactions: bets.map(b => ({ provider_txn_id: b.provider_txn_id as string })),
          }
          if (transaction_id) {
            await conn.execute(
              `INSERT IGNORE INTO bg_idempotency (idempotency_key, scope, response_snapshot, expires_at)
               VALUES (?, 'sg_callback', ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
              [transaction_id, JSON.stringify(resp)],
            )
          }
          await conn.commit()
          return resp
        }
        await conn.rollback()
        const [[row]] = await db.query<RowDataPacket[]>(
          'SELECT available_cents FROM bg_wallet WHERE user_id = ?',
          [player_id],
        )
        return {
          balance: centsToBalance(Number(row?.available_cents ?? 0)),
          transaction_id: txId(),
          rollback_transactions: [],
        }
      } catch (e) {
        await conn.rollback()
        this.app.log.error({ err: e }, '[sg-callback] rollback error')
        return { error_code: 'INTERNAL_ERROR', error_description: 'Rollback failed' }
      } finally {
        conn.release()
      }
    }

    return { error_code: 'INTERNAL_ERROR', error_description: `Unknown action: ${action}` }
  }
}
