import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import { getMysqlPool } from '../clients/mysql.client.js'
import { getWallet } from '../services/store/mysql-store.js'
import { verifySgCallback } from '../services/slotegrator.service.js'
import { isMysqlEnabled } from '../clients/mysql.client.js'

const router = new Router({ prefix: '/sg' })

const centsToBalance = (c: number) => Math.round(c) / 100
const amountToCents = (a: string | number) => Math.round(parseFloat(String(a)) * 100)
const txId = () => `SG_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const lgId = () => `LG_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

function sgOk(ctx: { status: number; body: unknown }, body: unknown) {
  ctx.status = 200
  ctx.body = body
}

router.post('/callback', async (ctx) => {
  const env = ctx.state.env
  const body = ctx.request.body as Record<string, string>

  // Skip signature check in dev without credentials (avoids blocking local tests)
  const hasCreds = Boolean(env.SG_MERCHANT_KEY && env.SG_MERCHANT_ID)
  if (hasCreds && !verifySgCallback(body, ctx.headers as Record<string, string | string[] | undefined>, env.SG_MERCHANT_KEY)) {
    sgOk(ctx, { error_code: 'INTERNAL_ERROR', error_description: 'Invalid signature' })
    return
  }

  if (!isMysqlEnabled(env)) {
    sgOk(ctx, { error_code: 'INTERNAL_ERROR', error_description: 'Storage not ready' })
    return
  }

  const { action, player_id, transaction_id, amount, round_id, game_uuid = '' } = body
  const db = getMysqlPool(env)

  // ── balance ───────────────────────────────────────────────────────────────
  if (action === 'balance') {
    try {
      const w = await getWallet(env, player_id)
      sgOk(ctx, { balance: centsToBalance(w.available) })
    } catch {
      sgOk(ctx, { error_code: 'INTERNAL_ERROR', error_description: 'Balance lookup failed' })
    }
    return
  }

  // ── idempotency check ─────────────────────────────────────────────────────
  if (transaction_id) {
    const [cached] = await db.execute<RowDataPacket[]>(
      `SELECT response_snapshot FROM bg_idempotency WHERE idempotency_key = ? AND scope = 'sg_callback'`,
      [transaction_id],
    )
    if (cached[0]) {
      sgOk(ctx, JSON.parse(cached[0].response_snapshot as string))
      return
    }
  }

  const amtCents = amountToCents(amount ?? 0)

  // ── bet ───────────────────────────────────────────────────────────────────
  if (action === 'bet') {
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      const [[row]] = await conn.query<RowDataPacket[]>(
        `SELECT available_cents FROM bg_wallet WHERE user_id = ? FOR UPDATE`,
        [player_id],
      )
      if (!row || Number(row.available_cents) < amtCents) {
        await conn.rollback()
        sgOk(ctx, { error_code: 'INSUFFICIENT_FUNDS', error_description: 'Insufficient balance' })
        return
      }

      await conn.execute(
        `UPDATE bg_wallet SET available_cents = available_cents - ?, version = version + 1 WHERE user_id = ?`,
        [amtCents, player_id],
      )
      const [[after]] = await conn.query<RowDataPacket[]>(
        `SELECT available_cents FROM bg_wallet WHERE user_id = ?`,
        [player_id],
      )
      const bal = Number(after?.available_cents ?? 0)

      await conn.execute(
        `INSERT INTO bg_wallet_ledger (id, user_id, type, amount_cents, balance_after, ref_type, ref_id, description)
         VALUES (?, ?, 'bet', ?, ?, 'game', ?, ?)`,
        [lgId(), player_id, -amtCents, bal, round_id ?? null, `${game_uuid} bet`],
      )
      await conn.execute(
        `INSERT INTO bg_bet_order (user_id, aggregator_id, provider_id, provider_txn_id, round_id, bet_type, amount_cents, status)
         VALUES (?, 'slotegrator', ?, ?, ?, 'bet', ?, 'settled')`,
        [player_id, game_uuid, transaction_id, round_id ?? null, amtCents],
      )

      const resp = { balance: centsToBalance(bal), transaction_id: txId() }
      await conn.execute(
        `INSERT IGNORE INTO bg_idempotency (idempotency_key, scope, response_snapshot, expires_at)
         VALUES (?, 'sg_callback', ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
        [transaction_id, JSON.stringify(resp)],
      )
      await conn.commit()
      sgOk(ctx, resp)
    } catch (e) {
      await conn.rollback()
      console.error('[sg-callback] bet error:', e)
      sgOk(ctx, { error_code: 'INTERNAL_ERROR', error_description: 'Bet failed' })
    } finally {
      conn.release()
    }
    return
  }

  // ── win / refund ──────────────────────────────────────────────────────────
  if (action === 'win' || action === 'refund') {
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      await conn.execute(
        `UPDATE bg_wallet SET available_cents = available_cents + ?, version = version + 1 WHERE user_id = ?`,
        [amtCents, player_id],
      )
      const [[after]] = await conn.query<RowDataPacket[]>(
        `SELECT available_cents FROM bg_wallet WHERE user_id = ?`,
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
        `INSERT INTO bg_bet_order (user_id, aggregator_id, provider_id, provider_txn_id, round_id, bet_type, amount_cents, status)
         VALUES (?, 'slotegrator', ?, ?, ?, ?, ?, 'settled')`,
        [player_id, game_uuid, transaction_id, round_id ?? null, action, amtCents],
      )

      const resp = { balance: centsToBalance(bal), transaction_id: txId() }
      await conn.execute(
        `INSERT IGNORE INTO bg_idempotency (idempotency_key, scope, response_snapshot, expires_at)
         VALUES (?, 'sg_callback', ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
        [transaction_id, JSON.stringify(resp)],
      )
      await conn.commit()
      sgOk(ctx, resp)
    } catch (e) {
      await conn.rollback()
      console.error('[sg-callback] win/refund error:', e)
      sgOk(ctx, { error_code: 'INTERNAL_ERROR', error_description: `${action} failed` })
    } finally {
      conn.release()
    }
    return
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
      const refundCents = (bets as RowDataPacket[]).reduce((s, r) => s + Number(r.amount_cents), 0)

      if (refundCents > 0) {
        await conn.execute(
          `UPDATE bg_wallet SET available_cents = available_cents + ?, version = version + 1 WHERE user_id = ?`,
          [refundCents, player_id],
        )
        const [[after]] = await conn.query<RowDataPacket[]>(
          `SELECT available_cents FROM bg_wallet WHERE user_id = ?`,
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
          rollback_transactions: (bets as RowDataPacket[]).map((b) => ({
            provider_txn_id: b.provider_txn_id as string,
          })),
        }
        if (transaction_id) {
          await conn.execute(
            `INSERT IGNORE INTO bg_idempotency (idempotency_key, scope, response_snapshot, expires_at)
             VALUES (?, 'sg_callback', ?, DATE_ADD(NOW(), INTERVAL 24 HOUR))`,
            [transaction_id, JSON.stringify(resp)],
          )
        }
        await conn.commit()
        sgOk(ctx, resp)
      } else {
        await conn.rollback()
        const w = await getWallet(env, player_id)
        sgOk(ctx, {
          balance: centsToBalance(w.available),
          transaction_id: txId(),
          rollback_transactions: [],
        })
      }
    } catch (e) {
      await conn.rollback()
      console.error('[sg-callback] rollback error:', e)
      sgOk(ctx, { error_code: 'INTERNAL_ERROR', error_description: 'Rollback failed' })
    } finally {
      conn.release()
    }
    return
  }

  sgOk(ctx, { error_code: 'INTERNAL_ERROR', error_description: `Unknown action: ${action}` })
})

export default router
