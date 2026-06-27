import type { FastifyInstance } from 'fastify'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import type { Redis } from 'ioredis'
import { lgId, txId } from '../utils/id.js'
import { allocateBetTurnoverInTransaction, reverseBetTurnover } from './turnover.service.js'

export interface SgCallbackBody {
  action: string
  player_id: string
  session_id?: string
  transaction_id?: string
  amount?: string | number
  round_id?: string
  game_uuid?: string
  currency?: string
  rollback_transactions?: Array<{ transaction_id?: string; provider_txn_id?: string }>
}

/** 单币种模式：SG 用 EUR，钱包读写映射到用户进游戏时选的币种（1:1 金额） */
async function resolveWalletCurrency(
  redis: Redis,
  playerId: string,
  sessionId: string | undefined,
): Promise<string> {
  if (sessionId) {
    const raw = await redis.get(`sg:session:${sessionId}`)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { wallet?: string }
        if (parsed.wallet) return parsed.wallet.toUpperCase()
      } catch {
        // 旧格式：value 仅为 userId
      }
    }
  }
  const fallback = await redis.get(`sg:player:${playerId}:wallet`)
  return (fallback ?? 'PHP').toUpperCase()
}

export class SgCallbackService {
  constructor(private app: FastifyInstance) {}

  private get db() { return this.app.mysql }
  private get redis(): Redis { return this.app.redis as unknown as Redis }

  async handle(body: SgCallbackBody, sgCurrency: string, multiCurrency: boolean): Promise<unknown> {
    const { action, player_id, transaction_id, round_id, game_uuid = '' } = body
    // multiCurrency=true：按回调 currency；false：SG 侧 EUR，钱包用 session 映射币种（1:1）
    const currency = multiCurrency
      ? ((body.currency ?? sgCurrency).toUpperCase())
      : await resolveWalletCurrency(this.redis, player_id, body.session_id)
    const db = this.db

    // ── balance ───────────────────────────────────────────────────────────────
    if (action === 'balance') {
      const [[row]] = await db.query<RowDataPacket[]>(
        'SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ?',
        [player_id, currency],
      )
      const bal = Number(row?.available ?? 0)
      this.app.log.info({ player_id, currency, session_id: body.session_id, balance: bal }, '[sg-callback] balance')
      return { balance: bal }
    }

    // ── idempotency ───────────────────────────────────────────────────────────
    if (transaction_id) {
      const [[cached]] = await db.execute<RowDataPacket[]>(
        `SELECT response_snapshot FROM bg_idempotency WHERE idempotency_key = ? AND scope = 'sg_callback'`,
        [transaction_id],
      )
      if (cached) {
        const snap = cached.response_snapshot
        const parsed = typeof snap === 'string' ? JSON.parse(snap) : snap
        this.app.log.info({ action, player_id, transaction_id, cached: parsed }, '[sg-callback] idempotency hit')
        return parsed
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
          this.app.log.warn({ player_id, currency, available: row?.available, amount }, '[sg-callback] bet INSUFFICIENT_FUNDS')
          return { error_code: 'INSUFFICIENT_FUNDS', error_description: 'Insufficient balance' }
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
        await allocateBetTurnoverInTransaction(conn, player_id, betOrderId, amount, game_uuid, currency)
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
