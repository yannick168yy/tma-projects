import type { FastifyInstance } from 'fastify'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { Redis } from 'ioredis'
import { lgId, txId } from '../utils/id.js'
import { allocateBetTurnover, reverseBetTurnover } from './turnover.service.js'

export interface SgCallbackBody {
  action: string
  player_id: string
  transaction_id?: string
  amount?: string | number
  round_id?: string
  game_uuid?: string
  currency?: string
  rollback_transactions?: Array<{ transaction_id?: string; provider_txn_id?: string }>
}

export class SgCallbackService {
  constructor(private app: FastifyInstance) {}

  private get db() { return this.app.mysql }
  private get redis(): Redis { return this.app.redis as unknown as Redis }

  async handle(body: SgCallbackBody, sgCurrency: string, multiCurrency: boolean): Promise<unknown> {
    const { action, player_id, transaction_id, round_id, game_uuid = '' } = body
    // multiCurrency=true 时用回调里的 currency 字段，否则统一用 sgCurrency（测试环境 EUR）
    const currency = multiCurrency ? ((body.currency ?? sgCurrency).toUpperCase()) : sgCurrency
    const db = this.db

    // ── balance ───────────────────────────────────────────────────────────────
    if (action === 'balance') {
      const [[row]] = await db.query<RowDataPacket[]>(
        'SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ?',
        [player_id, currency],
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

    const amount = parseFloat(String(body.amount ?? 0))

    // ── bet ───────────────────────────────────────────────────────────────────
    if (action === 'bet') {
      const conn = await db.getConnection()
      try {
        await conn.beginTransaction()
        const [[row]] = await conn.query<RowDataPacket[]>(
          'SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ? FOR UPDATE',
          [player_id, currency],
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
          'UPDATE bg_wallet SET available = available - ?, version = version + 1 WHERE user_id = ? AND currency = ?',
          [amount, player_id, currency],
        )
        const [[after]] = await conn.query<RowDataPacket[]>(
          'SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ?',
          [player_id, currency],
        )
        const bal = Number(after?.available ?? 0)
        await conn.execute(
          `INSERT INTO bg_wallet_ledger (id, user_id, currency, type, amount, balance_after, ref_type, ref_id, description)
           VALUES (?, ?, ?, 'bet', ?, ?, 'game', ?, ?)`,
          [lgId(), player_id, currency, -amount, bal, round_id ?? null, `${game_uuid} bet`],
        )
        const [betResult] = await conn.execute<ResultSetHeader>(
          `INSERT INTO bg_bet_order (user_id, aggregator_id, provider_id, provider_txn_id, round_id, bet_type, amount, currency_code, original_amount, exchange_rate, status)
           VALUES (?, 'slotegrator', ?, ?, ?, 'bet', ?, ?, ?, 1, 'settled')`,
          [player_id, game_uuid, transaction_id ?? null, round_id ?? null, amount, currency, amount],
        )
        const betOrderId = betResult.insertId
        const resp = { balance: bal, transaction_id: txId() }
        if (transaction_id) {
          await conn.execute(
            `INSERT IGNORE INTO bg_idempotency (idempotency_key, scope, response_snapshot, expires_at)
             VALUES (?, 'sg_callback', ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
            [transaction_id, JSON.stringify(resp)],
          )
        }
        await conn.commit()
        allocateBetTurnover(db, player_id, betOrderId, amount, game_uuid, currency).catch((err) => {
          this.app.log.error({ err }, '[turnover] allocateBetTurnover failed')
        })
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
          `INSERT INTO bg_wallet (user_id, currency, available, version)
           VALUES (?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE available = available + ?, version = version + 1`,
          [player_id, currency, amount, amount],
        )
        const [[after]] = await conn.query<RowDataPacket[]>(
          'SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ?',
          [player_id, currency],
        )
        const bal = Number(after?.available ?? 0)
        const ledgerType = action === 'win' ? 'win' : 'adjust'
        await conn.execute(
          `INSERT INTO bg_wallet_ledger (id, user_id, currency, type, amount, balance_after, ref_type, ref_id, description)
           VALUES (?, ?, ?, ?, ?, ?, 'game', ?, ?)`,
          [lgId(), player_id, currency, ledgerType, amount, bal, round_id ?? null, `${game_uuid} ${action}`],
        )
        await conn.execute(
          `INSERT INTO bg_bet_order (user_id, aggregator_id, provider_id, provider_txn_id, round_id, bet_type, amount, currency_code, original_amount, exchange_rate, status)
           VALUES (?, 'slotegrator', ?, ?, ?, ?, ?, ?, ?, 1, 'settled')`,
          [player_id, game_uuid, transaction_id ?? null, round_id ?? null, action, amount, currency, amount],
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
          `SELECT provider_txn_id, amount, currency_code
           FROM bg_bet_order
           WHERE user_id = ? AND round_id = ? AND bet_type = 'bet' AND aggregator_id = 'slotegrator'`,
          [player_id, round_id ?? ''],
        )

        if (bets.length > 0) {
          // 按货币分组退款
          const byCurrency = new Map<string, number>()
          for (const b of bets) {
            const c = (b.currency_code as string) ?? currency
            byCurrency.set(c, (byCurrency.get(c) ?? 0) + Number(b.amount))
          }
          for (const [cur, amt] of byCurrency) {
            await conn.execute(
              `INSERT INTO bg_wallet (user_id, currency, available, version)
               VALUES (?, ?, ?, 1)
               ON DUPLICATE KEY UPDATE available = available + ?, version = version + 1`,
              [player_id, cur, amt, amt],
            )
            const refundAmt = amt
            await conn.execute(
              `INSERT INTO bg_wallet_ledger (id, user_id, currency, type, amount, balance_after, ref_type, ref_id, description)
               VALUES (?, ?, ?, 'adjust', ?,
                 (SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ?),
                 'game', ?, ?)`,
              [lgId(), player_id, cur, refundAmt, player_id, cur, round_id ?? null, `${game_uuid} rollback`],
            )
          }
        }

        const [[after]] = await conn.query<RowDataPacket[]>(
          'SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ?',
          [player_id, currency],
        )
        const bal = Number(after?.available ?? 0)
        const resp = {
          balance: bal,
          transaction_id: txId(),
          rollback_transactions: bets.map((b) => ({ provider_txn_id: b.provider_txn_id as string })),
        }
        if (transaction_id) {
          await conn.execute(
            `INSERT IGNORE INTO bg_idempotency (idempotency_key, scope, response_snapshot, expires_at)
             VALUES (?, 'sg_callback', ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
            [transaction_id, JSON.stringify(resp)],
          )
        }
        await conn.commit()
        if (round_id) {
          reverseBetTurnover(db, player_id, round_id).catch((err) => {
            this.app.log.error({ err }, '[turnover] reverseBetTurnover failed')
          })
        }
        return resp
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
