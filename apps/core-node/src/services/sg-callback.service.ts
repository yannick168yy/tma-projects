import type { FastifyInstance } from 'fastify'
import type { RowDataPacket } from 'mysql2/promise'
import type { Redis } from 'ioredis'
import { lgId, txId } from '../utils/id.js'

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
        'SELECT available FROM bg_wallet WHERE user_id = ?',
        [player_id],
      )
      if (!row) return { error_code: 'PLAYER_NOT_FOUND', error_description: 'Player not found' }
      return { balance: Number(row.available) }
    }

    // ── idempotency ───────────────────────────────────────────────────────────
    if (transaction_id) {
      const [[cached]] = await db.execute<RowDataPacket[]>(
        `SELECT response_snapshot FROM bg_idempotency WHERE idempotency_key = ? AND scope = 'sg_callback'`,
        [transaction_id],
      )
      if (cached) {
        const snap = cached.response_snapshot
        return typeof snap === 'string' ? JSON.parse(snap) : snap
      }
    }

    // 金额直接使用，不做币种换算（测试环境 SG 仅支持 EUR，忽略汇率）
    const originalAmt = parseFloat(String(body.amount ?? 0))
    const amount = originalAmt
    const exchangeRate = 1

    // ── bet ───────────────────────────────────────────────────────────────────
    if (action === 'bet') {
      const conn = await db.getConnection()
      try {
        await conn.beginTransaction()
        const [[row]] = await conn.query<RowDataPacket[]>(
          'SELECT available FROM bg_wallet WHERE user_id = ? FOR UPDATE',
          [player_id],
        )
        if (!row || Number(row.available) < amount) {
          await conn.rollback()
          const resp = { error_code: 'INSUFFICIENT_FUNDS', error_description: 'Insufficient balance' }
          if (transaction_id) {
            await db.execute(
              `INSERT IGNORE INTO bg_idempotency (idempotency_key, scope, response_snapshot, expires_at)
               VALUES (?, 'sg_callback', ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
              [transaction_id, JSON.stringify(resp)],
            )
          }
          return resp
        }
        await conn.execute(
          'UPDATE bg_wallet SET available = available - ?, version = version + 1 WHERE user_id = ?',
          [amount, player_id],
        )
        const [[after]] = await conn.query<RowDataPacket[]>(
          'SELECT available FROM bg_wallet WHERE user_id = ?',
          [player_id],
        )
        const bal = Number(after?.available ?? 0)
        await conn.execute(
          `INSERT INTO bg_wallet_ledger (id, user_id, type, amount, balance_after, ref_type, ref_id, description)
           VALUES (?, ?, 'bet', ?, ?, 'game', ?, ?)`,
          [lgId(), player_id, -amount, bal, round_id ?? null, `${game_uuid} bet`],
        )
        await conn.execute(
          `INSERT INTO bg_bet_order (user_id, aggregator_id, provider_id, provider_txn_id, round_id, bet_type, amount, currency_code, original_amount, exchange_rate, status)
           VALUES (?, 'slotegrator', ?, ?, ?, 'bet', ?, ?, ?, ?, 'settled')`,
          [player_id, game_uuid, transaction_id ?? null, round_id ?? null, amount, sgCurrency, originalAmt, exchangeRate],
        )
        const resp = { balance: bal, transaction_id: txId() }
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
          'UPDATE bg_wallet SET available = available + ?, version = version + 1 WHERE user_id = ?',
          [amount, player_id],
        )
        const [[after]] = await conn.query<RowDataPacket[]>(
          'SELECT available FROM bg_wallet WHERE user_id = ?',
          [player_id],
        )
        const bal = Number(after?.available ?? 0)
        const ledgerType = action === 'win' ? 'win' : 'adjust'
        await conn.execute(
          `INSERT INTO bg_wallet_ledger (id, user_id, type, amount, balance_after, ref_type, ref_id, description)
           VALUES (?, ?, ?, ?, ?, 'game', ?, ?)`,
          [lgId(), player_id, ledgerType, amount, bal, round_id ?? null, `${game_uuid} ${action}`],
        )
        await conn.execute(
          `INSERT INTO bg_bet_order (user_id, aggregator_id, provider_id, provider_txn_id, round_id, bet_type, amount, currency_code, original_amount, exchange_rate, status)
           VALUES (?, 'slotegrator', ?, ?, ?, ?, ?, ?, ?, ?, 'settled')`,
          [player_id, game_uuid, transaction_id ?? null, round_id ?? null, action, amount, sgCurrency, originalAmt, exchangeRate],
        )
        const resp = { balance: bal, transaction_id: txId() }
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
          `SELECT provider_txn_id, amount FROM bg_bet_order
           WHERE user_id = ? AND round_id = ? AND bet_type = 'bet' AND aggregator_id = 'slotegrator'`,
          [player_id, round_id ?? ''],
        )
        const refundAmt = bets.reduce((s, r) => s + Number(r.amount), 0)
        if (refundAmt > 0) {
          await conn.execute(
            'UPDATE bg_wallet SET available = available + ?, version = version + 1 WHERE user_id = ?',
            [refundAmt, player_id],
          )
          const [[after]] = await conn.query<RowDataPacket[]>(
            'SELECT available FROM bg_wallet WHERE user_id = ?',
            [player_id],
          )
          const bal = Number(after?.available ?? 0)
          await conn.execute(
            `INSERT INTO bg_wallet_ledger (id, user_id, type, amount, balance_after, ref_type, ref_id, description)
             VALUES (?, ?, 'adjust', ?, ?, 'game', ?, ?)`,
            [lgId(), player_id, refundAmt, bal, round_id ?? null, `${game_uuid} rollback`],
          )
          const resp = {
            balance: bal,
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
          'SELECT available FROM bg_wallet WHERE user_id = ?',
          [player_id],
        )
        return {
          balance: Number(row?.available ?? 0),
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

    return { error_code: 'UNKNOWN_ACTION', error_description: `Unknown action: ${action}` }
  }
}
