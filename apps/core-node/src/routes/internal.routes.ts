/**
 * 内部服务接口（仅供 bff-node 调用，需 X-Internal-Token）
 */
import type { FastifyInstance } from 'fastify'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import type { Redis } from 'ioredis'
import { env } from '../config/env.js'
import { lgId } from '../utils/id.js'

// PHT = UTC+8，结算周期按菲律宾本地月份切割
const PHT_OFFSET_MS = 8 * 60 * 60 * 1000

// 共用：首充激活（所有支付通道调用同一段 SQL，避免漏接通道）
async function tryActivateTeamNode(
  conn: PoolConnection,
  userId: string,
  creditedCents: number,
): Promise<void> {
  await conn.execute(
    `UPDATE bg_team_node tn
     SET tn.activated = 1,
         tn.activation_cents = ?,
         tn.activated_at = NOW(3)
     WHERE tn.user_id = ?
       AND tn.activated = 0
       AND ? >= (SELECT min_activation_cents FROM bg_team_config WHERE id = 1 LIMIT 1)`,
    [creditedCents, userId, creditedCents],
  )
}

// 共用：钱包入账 + ledger（在已开启的事务内调用）
async function creditWalletInTx(
  conn: PoolConnection,
  userId: string,
  amount: number,
  refId: string,
  description: string,
  currency = 'PHP',
): Promise<number> {
  await conn.execute(
    `INSERT INTO bg_wallet (user_id, currency, available, version)
     VALUES (?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE available = available + ?, version = version + 1`,
    [userId, currency, amount, amount],
  )
  const [[wallet]] = await conn.query<RowDataPacket[]>(
    `SELECT available FROM bg_wallet WHERE user_id = ? AND currency = ?`,
    [userId, currency],
  )
  const balanceAfter = Number(wallet?.available ?? 0)
  await conn.execute(
    `INSERT INTO bg_wallet_ledger (id, user_id, currency, type, amount, balance_after, ref_type, ref_id, description)
     VALUES (?, ?, ?, 'deposit', ?, ?, 'deposit', ?, ?)`,
    [lgId(), userId, currency, amount, balanceAfter, refId, description],
  )
  return balanceAfter
}

export async function internalRoutes(app: FastifyInstance) {
  // 所有 /internal/* 路由都验 token；未配置 token 时 fail-closed
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/internal/')) return
    const token = req.headers['x-internal-token']
    if (!env.INTERNAL_TOKEN || token !== env.INTERNAL_TOKEN) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }
  })

  // POST /internal/payment/tg-wallet
  app.post<{
    Body: {
      orderId: string
      userId: string
      amount: number
      creditedCents: number
      currency: string
      description?: string
    }
  }>('/internal/payment/tg-wallet', async (req, reply) => {
    const { orderId, userId, creditedCents, description } = req.body

    if (!orderId || !userId || creditedCents <= 0) {
      return reply.status(400).send({ code: 400, message: 'invalid payload' })
    }

    const db = app.mysql
    const redis = app.redis as unknown as Redis

    const idempotencyKey = `tgwallet:cb:${orderId}`
    const locked = await redis.set(idempotencyKey, '1', 'EX', 604800, 'NX')
    if (!locked) return reply.send({ code: 0, message: 'duplicate, skipped' })

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT status FROM bg_deposit_order WHERE order_id = ? LIMIT 1`,
      [orderId],
    )
    if (rows[0]?.status === 'paid') return reply.send({ code: 0, message: 'already paid' })

    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      const balanceAfter = await creditWalletInTx(
        conn, userId, creditedCents, orderId,
        description ?? 'Telegram Wallet deposit',
      )
      await conn.execute(
        `UPDATE bg_deposit_order SET status='paid', credited=1 WHERE order_id=?`,
        [orderId],
      )
      await tryActivateTeamNode(conn, userId, creditedCents)
      await conn.commit()
      app.log.info({ orderId, userId, creditedCents }, 'TG Wallet deposit settled')
      return reply.send({ code: 0, message: 'ok', balanceAfter })
    } catch (err) {
      await conn.rollback()
      app.log.error({ err, orderId }, 'TG Wallet deposit failed')
      return reply.status(500).send({ code: 500, message: 'internal error' })
    } finally {
      conn.release()
    }
  })

  // POST /internal/payment/yfpay
  // BFF 收到 YFPay 支付回调（state=2）后转发到此处入账 + 激活
  app.post<{
    Body: {
      orderId: string     // merchantSerial
      userId: string
      creditedCents: number  // PHP 分（BFF 已转换）
    }
  }>('/internal/payment/yfpay', async (req, reply) => {
    const { orderId, userId, creditedCents } = req.body

    if (!orderId || !userId || creditedCents <= 0) {
      return reply.status(400).send({ code: 400, message: 'invalid payload' })
    }

    const db = app.mysql
    const redis = app.redis as unknown as Redis

    const idempotencyKey = `yfpay:cb:${orderId}`
    const locked = await redis.set(idempotencyKey, '1', 'EX', 604800, 'NX')
    if (!locked) return reply.send({ code: 0, message: 'duplicate, skipped' })

    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT status FROM bg_deposit_order WHERE order_id = ? LIMIT 1`,
      [orderId],
    )
    if (rows[0]?.status === 'paid') return reply.send({ code: 0, message: 'already paid' })

    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      const balanceAfter = await creditWalletInTx(
        conn, userId, creditedCents, orderId, 'YFPay deposit',
      )
      await conn.execute(
        `UPDATE bg_deposit_order SET status='paid', credited=1 WHERE order_id=?`,
        [orderId],
      )
      await tryActivateTeamNode(conn, userId, creditedCents)
      await conn.commit()
      app.log.info({ orderId, userId, creditedCents }, 'YFPay deposit settled')
      return reply.send({ code: 0, message: 'ok', balanceAfter })
    } catch (err) {
      await conn.rollback()
      app.log.error({ err, orderId }, 'YFPay deposit failed')
      return reply.status(500).send({ code: 500, message: 'internal error' })
    } finally {
      conn.release()
    }
  })

  // POST /internal/team/settle  — 触发月度 GGR 结算（异步，立即返回）
  app.post<{ Body: { period: string } }>('/internal/team/settle', async (req, reply) => {
    const { period } = req.body
    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      return reply.status(400).send({ code: 400, message: 'period 格式应为 YYYY-MM' })
    }
    runTeamSettlement(app, period).catch((err: unknown) =>
      app.log.error({ err, period }, '[team-settle] failed'),
    )
    return reply.send({ code: 0, message: 'settlement triggered', period })
  })

  // POST /internal/team/withdrawal/approve  — 执行提现划转
  app.post<{ Body: { withdrawalId: number } }>('/internal/team/withdrawal/approve', async (req, reply) => {
    const { withdrawalId } = req.body
    if (!withdrawalId) return reply.status(400).send({ code: 400, message: 'withdrawalId required' })
    const db = app.mysql
    const conn = await db.getConnection()
    try {
      const [[wd]] = await conn.query<RowDataPacket[]>(
        `SELECT user_id, amount_cents, status FROM bg_team_withdrawal WHERE id = ? LIMIT 1`,
        [withdrawalId],
      )
      if (!wd) return reply.status(404).send({ code: 404, message: 'withdrawal not found' })
      if (wd.status !== 'pending') return reply.send({ code: 0, message: 'already processed' })

      await conn.beginTransaction()
      const [twRes] = await conn.execute<import('mysql2/promise').ResultSetHeader>(
        `UPDATE bg_team_wallet
         SET frozen_cents = frozen_cents - ?,
             available_cents = available_cents - 0
         WHERE user_id = ? AND frozen_cents >= ?`,
        [wd.amount_cents, wd.user_id, wd.amount_cents],
      )
      if (twRes.affectedRows === 0) throw new Error('insufficient frozen balance')

      await conn.execute(
        `INSERT INTO bg_wallet (user_id, currency, available, version)
         VALUES (?, 'PHP', ?, 1)
         ON DUPLICATE KEY UPDATE available = available + ?, version = version + 1`,
        [wd.user_id, wd.amount_cents, wd.amount_cents],
      )
      const [[walletRow]] = await conn.query<RowDataPacket[]>(
        `SELECT available FROM bg_wallet WHERE user_id = ? AND currency = 'PHP'`,
        [wd.user_id],
      )
      const balanceAfter = Number(walletRow?.available ?? 0)
      await conn.execute(
        `INSERT INTO bg_wallet_ledger (id, user_id, currency, type, amount, balance_after, ref_type, ref_id, description)
         VALUES (?, ?, 'PHP', 'bonus', ?, ?, 'team_withdrawal', ?, 'Team commission payout')`,
        [lgId(), wd.user_id, wd.amount_cents, balanceAfter, String(withdrawalId)],
      )
      await conn.execute(
        `UPDATE bg_team_withdrawal SET status='approved', reviewed_at=NOW(3) WHERE id=?`,
        [withdrawalId],
      )
      await conn.commit()
      return reply.send({ code: 0, message: 'ok' })
    } catch (err) {
      await conn.rollback()
      app.log.error({ err, withdrawalId }, '[team-withdrawal] approve failed')
      return reply.status(500).send({ code: 500, message: 'internal error' })
    } finally {
      conn.release()
    }
  })
}

// ── 月度 GGR 结算引擎 ──────────────────────────────────────────────────────
async function runTeamSettlement(app: FastifyInstance, period: string) {
  const db = app.mysql
  const [year, month] = period.split('-').map(Number)

  // 按菲律宾时间（UTC+8）切割月份边界，避免跨月偏移
  const startDate = new Date(Date.UTC(year, month - 1, 1) - PHT_OFFSET_MS)
  const endDate   = new Date(Date.UTC(year, month,     1) - PHT_OFFSET_MS)

  app.log.info({ period, startDate, endDate }, '[team-settle] start')

  // 费率与上限配置
  const [[cfg]] = await db.query<RowDataPacket[]>(
    `SELECT l1_rate_pct, l2_rate_pct, l3_rate_pct, max_commission_per_settlement_cents
     FROM bg_team_config WHERE id = 1 LIMIT 1`,
  )
  if (!cfg) throw new Error('bg_team_config not initialized')
  const rates = [Number(cfg.l1_rate_pct), Number(cfg.l2_rate_pct), Number(cfg.l3_rate_pct)]
  const maxCommission: number | null =
    cfg.max_commission_per_settlement_cents != null
      ? Number(cfg.max_commission_per_settlement_cents)
      : null

  // 聚合当月 GGR
  const [bets] = await db.query<RowDataPacket[]>(
    `SELECT user_id,
       SUM(CASE WHEN bet_type='bet' THEN amount_cents ELSE 0 END) AS bet_cents,
       SUM(CASE WHEN bet_type='win' THEN amount_cents ELSE 0 END) AS win_cents
     FROM bg_bet_order
     WHERE created_at >= ? AND created_at < ?
       AND bet_type IN ('bet','win') AND status = 'settled'
     GROUP BY user_id`,
    [startDate, endDate],
  )

  for (const row of bets) {
    const ggr = Number(row.bet_cents) - Number(row.win_cents)
    const effectiveGgr = Math.max(0, ggr)
    await db.execute(
      `INSERT INTO bg_team_ggr_monthly
         (user_id, period, bet_cents, win_cents, ggr_cents, effective_ggr_cents, negative_ggr)
       VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         bet_cents=VALUES(bet_cents), win_cents=VALUES(win_cents),
         ggr_cents=VALUES(ggr_cents), effective_ggr_cents=VALUES(effective_ggr_cents),
         negative_ggr=VALUES(negative_ggr)`,
      [row.user_id, period, row.bet_cents, row.win_cents, ggr, effectiveGgr, ggr < 0 ? 1 : 0],
    )
  }

  const positiveUsers = bets.filter(r => Number(r.bet_cents) - Number(r.win_cents) > 0)
  if (positiveUsers.length === 0) {
    app.log.info({ period }, '[team-settle] no positive GGR users')
    return
  }
  const userIds = positiveUsers.map(r => r.user_id)

  const [nodes] = await db.query<RowDataPacket[]>(
    `SELECT user_id, l1_referrer_id, l2_referrer_id, l3_referrer_id
     FROM bg_team_node WHERE user_id IN (?) AND activated = 1`,
    [userIds],
  )
  const nodeMap = new Map(nodes.map(n => [n.user_id as string, n]))

  for (const row of positiveUsers) {
    const effectiveGgr = Math.max(0, Number(row.bet_cents) - Number(row.win_cents))
    const node = nodeMap.get(row.user_id as string)
    if (!node) continue
    const referrers = [
      { id: node.l1_referrer_id, level: 1, rate: rates[0] },
      { id: node.l2_referrer_id, level: 2, rate: rates[1] },
      { id: node.l3_referrer_id, level: 3, rate: rates[2] },
    ]
    for (const ref of referrers) {
      if (!ref.id) continue
      let commCents = Math.floor(effectiveGgr * ref.rate / 100)
      // 应用单次结算上限（若已配置）
      if (maxCommission !== null) commCents = Math.min(commCents, maxCommission)
      await db.execute(
        `INSERT IGNORE INTO bg_team_commission
           (beneficiary_id, from_user_id, level, period, ggr_cents, rate_pct, commission_cents, status)
         VALUES (?,?,?,?,?,?,?,'pending')`,
        [ref.id, row.user_id, ref.level, period, effectiveGgr, ref.rate, commCents],
      )
    }
  }

  const [pending] = await db.query<RowDataPacket[]>(
    `SELECT beneficiary_id, SUM(commission_cents) AS total
     FROM bg_team_commission WHERE period = ? AND status = 'pending'
     GROUP BY beneficiary_id`,
    [period],
  )

  for (const row of pending) {
    await db.execute(
      `INSERT IGNORE INTO bg_team_wallet (user_id) VALUES (?)`,
      [row.beneficiary_id],
    )
    let settled = false
    for (let i = 0; i < 3; i++) {
      const [[w]] = await db.query<RowDataPacket[]>(
        `SELECT version FROM bg_team_wallet WHERE user_id = ?`,
        [row.beneficiary_id],
      )
      const [res] = await db.execute<import('mysql2/promise').ResultSetHeader>(
        `UPDATE bg_team_wallet
         SET available_cents = available_cents + ?,
             lifetime_earned_cents = lifetime_earned_cents + ?,
             version = version + 1
         WHERE user_id = ? AND version = ?`,
        [row.total, row.total, row.beneficiary_id, w.version],
      )
      if (res.affectedRows > 0) { settled = true; break }
    }
    if (!settled) app.log.warn({ beneficiaryId: row.beneficiary_id }, '[team-settle] wallet update failed after 3 retries')
  }

  await db.execute(
    `UPDATE bg_team_commission SET status='paid', paid_at=NOW(3) WHERE period=? AND status='pending'`,
    [period],
  )
  await db.execute(
    `UPDATE bg_team_ggr_monthly SET settled=1, settled_at=NOW(3) WHERE period=?`,
    [period],
  )
  app.log.info({ period, users: positiveUsers.length, beneficiaries: pending.length }, '[team-settle] done')
}
