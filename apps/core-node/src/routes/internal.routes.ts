/**
 * 内部服务接口（仅供 bff-node 调用，需 X-Internal-Token）
 */
import type { FastifyInstance } from 'fastify'
import type { PoolConnection, RowDataPacket } from 'mysql2/promise'
import type { Redis } from 'ioredis'
import { env } from '../config/env.js'
import { lgId } from '../utils/id.js'
import { getPhpRate } from '../services/exchange-rate.service.js'
import { applyDepositPromos } from '../services/deposit-promo.service.js'

const PHT_OFFSET_MS = 8 * 60 * 60 * 1000

// 共用：首充激活
export async function tryActivateTeamNode(
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
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/internal/')) return
    const token = req.headers['x-internal-token']
    if (!env.INTERNAL_TOKEN || token !== env.INTERNAL_TOKEN) {
      return reply.status(401).send({ error: 'Unauthorized' })
    }
  })

  // POST /internal/payment/tg-wallet
  // creditedCents 语义为「已折算成 PHP 元」的入账金额（bff depositAmountToYuan 产出），钱包按 PHP 入账
  app.post<{
    Body: { orderId: string; userId: string; amount: number; creditedCents: number; currency: string; description?: string }
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
      `SELECT user_id, status, credited, currency, amount FROM bg_deposit_order WHERE order_id = ? LIMIT 1`, [orderId],
    )
    const order = rows[0]
    if (!order) {
      await redis.del(idempotencyKey)
      return reply.status(404).send({ code: 404, message: 'order not found' })
    }
    if (order.status === 'paid' || order.credited) return reply.send({ code: 0, message: 'already paid' })
    if (String(order.user_id) !== userId) {
      await redis.del(idempotencyKey)
      app.log.error({ orderId, userId, orderUserId: order.user_id }, 'TG Wallet deposit user mismatch')
      return reply.status(409).send({ code: 409, message: 'user mismatch' })
    }
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      // credited=0 条件是并发/重复回调的最终闸门：只有一个事务能标记成功
      const [mark] = await conn.execute<import('mysql2/promise').ResultSetHeader>(
        `UPDATE bg_deposit_order SET status='paid', credited=1 WHERE order_id=? AND credited=0`, [orderId],
      )
      if (mark.affectedRows === 0) {
        await conn.rollback()
        return reply.send({ code: 0, message: 'already paid' })
      }
      const balanceAfter = await creditWalletInTx(conn, userId, creditedCents, orderId, description ?? 'Telegram Wallet deposit')
      await tryActivateTeamNode(conn, userId, creditedCents)
      await conn.commit()
      await applyDepositPromos(db, {
        orderId, userId,
        amount: Number(order.amount ?? req.body.amount),
        currency: String(order.currency ?? req.body.currency ?? 'PHP'),
      }, app.log)
      return reply.send({ code: 0, message: 'ok', balanceAfter })
    } catch (err) {
      await conn.rollback()
      // 释放幂等锁，让上游重试仍有机会入账
      await redis.del(idempotencyKey).catch(() => {})
      app.log.error({ err, orderId }, 'TG Wallet deposit failed')
      return reply.status(500).send({ code: 500, message: 'internal error' })
    } finally {
      conn.release()
    }
  })

  // POST /internal/payment/yfpay
  // 与 yfpay-callback.handler 同规则：入账金额/币种/用户一律以订单行为准，不信任调用方传值
  app.post<{
    Body: { orderId: string; userId: string; creditedCents: number }
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
      `SELECT user_id, status, credited, currency, amount FROM bg_deposit_order WHERE order_id = ? LIMIT 1`, [orderId],
    )
    const order = rows[0]
    if (!order) {
      await redis.del(idempotencyKey)
      return reply.status(404).send({ code: 404, message: 'order not found' })
    }
    if (order.status === 'paid' || order.credited) return reply.send({ code: 0, message: 'already paid' })
    if (String(order.user_id) !== userId) {
      await redis.del(idempotencyKey)
      app.log.error({ orderId, userId, orderUserId: order.user_id }, 'YFPay deposit user mismatch')
      return reply.status(409).send({ code: 409, message: 'user mismatch' })
    }
    const creditAmount = Number(order.amount)
    const currency = String(order.currency ?? 'PHP')
    if (Math.abs(creditedCents - creditAmount) > 0.01) {
      app.log.warn({ orderId, creditedCents, orderAmount: creditAmount }, 'YFPay callback amount differs from order, crediting order amount')
    }
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      const [mark] = await conn.execute<import('mysql2/promise').ResultSetHeader>(
        `UPDATE bg_deposit_order SET status='paid', credited=1 WHERE order_id=? AND credited=0`, [orderId],
      )
      if (mark.affectedRows === 0) {
        await conn.rollback()
        return reply.send({ code: 0, message: 'already paid' })
      }
      const balanceAfter = await creditWalletInTx(conn, userId, creditAmount, orderId, 'YFPay deposit', currency)
      await tryActivateTeamNode(conn, userId, creditAmount)
      await conn.commit()
      await applyDepositPromos(db, {
        orderId, userId,
        amount: creditAmount,
        currency,
      }, app.log)
      return reply.send({ code: 0, message: 'ok', balanceAfter })
    } catch (err) {
      await conn.rollback()
      await redis.del(idempotencyKey).catch(() => {})
      app.log.error({ err, orderId }, 'YFPay deposit failed')
      return reply.status(500).send({ code: 500, message: 'internal error' })
    } finally {
      conn.release()
    }
  })

  // POST /internal/payment/beepay
  // 供 BFF 主动查询到 BeePay 成功但回调尚未到达时补偿入账；金额/币种仍以订单行为准。
  app.post<{
    Body: { orderId: string; userId: string; creditedCents: number }
  }>('/internal/payment/beepay', async (req, reply) => {
    const { orderId, userId, creditedCents } = req.body
    if (!orderId || !userId || creditedCents <= 0) {
      return reply.status(400).send({ code: 400, message: 'invalid payload' })
    }
    const db = app.mysql
    const redis = app.redis as unknown as Redis
    const idempotencyKey = `beepay:sync:${orderId}`
    const locked = await redis.set(idempotencyKey, '1', 'EX', 604800, 'NX')
    if (!locked) return reply.send({ code: 0, message: 'duplicate, skipped' })
    const [rows] = await db.query<RowDataPacket[]>(
      `SELECT user_id, status, credited, currency, amount FROM bg_deposit_order WHERE order_id = ? LIMIT 1`, [orderId],
    )
    const order = rows[0]
    if (!order) {
      await redis.del(idempotencyKey)
      return reply.status(404).send({ code: 404, message: 'order not found' })
    }
    if (order.status === 'paid' || order.credited) return reply.send({ code: 0, message: 'already paid' })
    if (String(order.user_id) !== userId) {
      await redis.del(idempotencyKey)
      app.log.error({ orderId, userId, orderUserId: order.user_id }, 'BeePay deposit user mismatch')
      return reply.status(409).send({ code: 409, message: 'user mismatch' })
    }
    const creditAmount = Number(order.amount)
    const currency = String(order.currency ?? 'PHP')
    if (Math.abs(creditedCents - creditAmount) > 0.01) {
      app.log.warn({ orderId, creditedCents, orderAmount: creditAmount }, 'BeePay query amount differs from order, crediting order amount')
    }
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      const [mark] = await conn.execute<import('mysql2/promise').ResultSetHeader>(
        `UPDATE bg_deposit_order SET status='paid', credited=1 WHERE order_id=? AND credited=0`, [orderId],
      )
      if (mark.affectedRows === 0) {
        await conn.rollback()
        return reply.send({ code: 0, message: 'already paid' })
      }
      const balanceAfter = await creditWalletInTx(conn, userId, creditAmount, orderId, 'BeePay deposit', currency)
      await tryActivateTeamNode(conn, userId, creditAmount)
      await conn.commit()
      await applyDepositPromos(db, {
        orderId, userId,
        amount: creditAmount,
        currency,
      }, app.log)
      return reply.send({ code: 0, message: 'ok', balanceAfter })
    } catch (err) {
      await conn.rollback()
      await redis.del(idempotencyKey).catch(() => {})
      app.log.error({ err, orderId }, 'BeePay deposit failed')
      return reply.status(500).send({ code: 500, message: 'internal error' })
    } finally {
      conn.release()
    }
  })

  // POST /internal/team/settle  { date: YYYY-MM-DD, force?: boolean }
  app.post<{ Body: { date: string; force?: boolean } }>('/internal/team/settle', async (req, reply) => {
    const { date, force = false } = req.body
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return reply.status(400).send({ code: 400, message: 'date 格式应为 YYYY-MM-DD' })
    }
    runDailySettlement(app, date, force).catch((err: unknown) =>
      app.log.error({ err, date }, '[daily-settle] failed'),
    )
    return reply.send({ code: 0, message: 'settlement triggered', date })
  })

  // POST /internal/team/withdrawal/approve
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

      const amountYuan = wd.amount_cents / 100
      await conn.beginTransaction()
      const [twRes] = await conn.execute<import('mysql2/promise').ResultSetHeader>(
        `UPDATE bg_team_wallet
         SET frozen_cents = frozen_cents - ?
         WHERE user_id = ? AND currency = 'PHP' AND frozen_cents >= ?`,
        [wd.amount_cents, wd.user_id, wd.amount_cents],
      )
      if (twRes.affectedRows === 0) throw new Error('insufficient frozen balance')
      await conn.execute(
        `INSERT INTO bg_wallet (user_id, currency, available, version)
         VALUES (?, 'PHP', ?, 1)
         ON DUPLICATE KEY UPDATE available = available + ?, version = version + 1`,
        [wd.user_id, amountYuan, amountYuan],
      )
      const [[walletRow]] = await conn.query<RowDataPacket[]>(
        `SELECT available FROM bg_wallet WHERE user_id = ? AND currency = 'PHP'`,
        [wd.user_id],
      )
      const balanceAfter = Number(walletRow?.available ?? 0)
      await conn.execute(
        `INSERT INTO bg_wallet_ledger (id, user_id, currency, type, amount, balance_after, ref_type, ref_id, description)
         VALUES (?, ?, 'PHP', 'bonus', ?, ?, 'team_withdrawal', ?, 'Team commission payout')`,
        [lgId(), wd.user_id, amountYuan, balanceAfter, String(withdrawalId)],
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

// ── 每日流水结算引擎 ──────────────────────────────────────────────────────────
export async function runDailySettlement(app: FastifyInstance, date: string, force = false): Promise<void> {
  const db = app.mysql

  // 覆盖模式：先回滚已入账佣金，再删旧记录
  // 回滚顺序：先扣 available_cents，不够再扣 frozen_cents（待审提现）
  // 若两者合计仍不足，说明差额已提走进主钱包，记录亏空并在重算时只补差额
  const withdrawnMap = new Map<string, number>() // beneficiaryId → 已不可回滚的金额
  if (force) {
    const [paidRows] = await db.query<RowDataPacket[]>(
      `SELECT tc.beneficiary_id, SUM(tc.php_equivalent_cents) AS total_php,
              tw.available_cents, tw.frozen_cents
       FROM bg_team_commission tc
       JOIN bg_team_wallet tw ON tw.user_id = tc.beneficiary_id AND tw.currency = 'PHP'
       WHERE tc.period = ? AND tc.status = 'paid'
       GROUP BY tc.beneficiary_id, tw.available_cents, tw.frozen_cents`,
      [date],
    )
    for (const row of paidRows) {
      const total     = Number(row.total_php)
      const available = Number(row.available_cents)
      const frozen    = Number(row.frozen_cents)
      if (total <= 0) continue

      const fromAvailable = Math.min(available, total)
      const fromFrozen    = Math.min(frozen, total - fromAvailable)
      const alreadyOut    = total - fromAvailable - fromFrozen // 已提走，无法回滚

      if (alreadyOut > 0) {
        withdrawnMap.set(String(row.beneficiary_id), alreadyOut)
        app.log.warn(
          { beneficiaryId: row.beneficiary_id, alreadyOut, date },
          '[daily-settle] partial rollback: commission already withdrawn, re-settle will credit net delta only',
        )
      }

      await db.execute(
        `UPDATE bg_team_wallet
         SET available_cents       = available_cents - ?,
             frozen_cents          = frozen_cents - ?,
             lifetime_earned_cents = lifetime_earned_cents - ?
         WHERE user_id = ? AND currency = 'PHP'`,
        [fromAvailable, fromFrozen, fromAvailable + fromFrozen, row.beneficiary_id],
      )
    }
    await db.execute(`DELETE FROM bg_team_commission WHERE period = ?`, [date])
    await db.execute(`DELETE FROM bg_team_turnover_daily WHERE date = ?`, [date])
    app.log.info({ date }, '[daily-settle] existing data cleared for force re-run')
  } else {
    const [[{ cnt }]] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM bg_team_commission WHERE period = ? LIMIT 1`, [date],
    )
    if (Number(cnt) > 0) {
      app.log.info({ date }, '[daily-settle] already settled, skip (use force=true to override)')
      return
    }
  }

  app.log.info({ date, force }, '[daily-settle] start')

  // 按 PHT 日期范围切割
  const [y, m, d] = date.split('-').map(Number)
  const startDate = new Date(Date.UTC(y, m - 1, d)     - PHT_OFFSET_MS)
  const endDate   = new Date(Date.UTC(y, m - 1, d + 1) - PHT_OFFSET_MS)

  // 聚合当日投注流水（仅 bet，不减 win）
  const [bets] = await db.query<RowDataPacket[]>(
    `SELECT user_id, COALESCE(currency_code, 'PHP') AS currency_code,
       ROUND(SUM(amount) * 100) AS bet_cents
     FROM bg_bet_order
     WHERE created_at >= ? AND created_at < ?
       AND bet_type = 'bet' AND status = 'settled'
     GROUP BY user_id, currency_code`,
    [startDate, endDate],
  )

  if (bets.length === 0) {
    app.log.info({ date }, '[daily-settle] no bets, done')
    return
  }

  // 写 bg_team_turnover_daily（各币种原始流水）
  for (const row of bets) {
    await db.execute(
      `INSERT INTO bg_team_turnover_daily (user_id, date, currency_code, bet_cents, settled)
       VALUES (?, ?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE bet_cents = VALUES(bet_cents), settled = 0`,
      [row.user_id, date, row.currency_code, row.bet_cents],
    )
  }

  // 查激活用户的归属树 + 套餐费率（NULL rate_plan_id → COALESCE 到 default 套餐）
  const userIds = [...new Set(bets.map(r => r.user_id as string))]
  const [[defaultPlan]] = await db.query<RowDataPacket[]>(
    `SELECT l1_rate_pct, l2_rate_pct, l3_rate_pct FROM bg_team_rate_plan WHERE is_default = 1 LIMIT 1`,
  )
  if (!defaultPlan) throw new Error('bg_team_rate_plan: no default plan')

  const [nodes] = await db.query<RowDataPacket[]>(
    `SELECT tn.user_id, tn.l1_referrer_id, tn.l2_referrer_id, tn.l3_referrer_id,
            COALESCE(rp.l1_rate_pct, ?) AS l1_rate_pct,
            COALESCE(rp.l2_rate_pct, ?) AS l2_rate_pct,
            COALESCE(rp.l3_rate_pct, ?) AS l3_rate_pct
     FROM bg_team_node tn
     LEFT JOIN bg_team_rate_plan rp ON rp.id = tn.rate_plan_id
     WHERE tn.user_id IN (?) AND tn.activated = 1`,
    [defaultPlan.l1_rate_pct, defaultPlan.l2_rate_pct, defaultPlan.l3_rate_pct, userIds],
  )
  const nodeMap = new Map(nodes.map(n => [n.user_id as string, n]))

  // 上限配置
  const [[cfg]] = await db.query<RowDataPacket[]>(
    `SELECT max_commission_per_settlement_cents FROM bg_team_config WHERE id = 1 LIMIT 1`,
  )
  const maxCommission: number | null =
    cfg?.max_commission_per_settlement_cents != null
      ? Number(cfg.max_commission_per_settlement_cents)
      : null

  // 汇率（一次批量获取）
  const currencies = [...new Set(bets.map(r => String(r.currency_code ?? 'PHP')))]
  const fxRates: Record<string, number> = {}
  await Promise.all(currencies.map(async cur => { fxRates[cur] = await getPhpRate(cur) }))
  app.log.info({ date, fxRates }, '[daily-settle] fx rates')

  // 按 from_user 聚合多币种投注，折算 PHP
  type Breakdown = { currency: string; betCents: number; fxRate: number }
  const userTotals = new Map<string, { phpCents: number; breakdown: Breakdown[] }>()
  for (const row of bets) {
    const uid = row.user_id as string
    const cur = String(row.currency_code ?? 'PHP')
    const betCents = Number(row.bet_cents)
    const fx = fxRates[cur] ?? 1
    const phpCents = Math.floor(betCents * fx)
    if (!userTotals.has(uid)) userTotals.set(uid, { phpCents: 0, breakdown: [] })
    const entry = userTotals.get(uid)!
    entry.phpCents += phpCents
    entry.breakdown.push({ currency: cur, betCents, fxRate: fx })
  }

  // 生成 commission 记录
  for (const [fromUserId, totals] of userTotals) {
    const node = nodeMap.get(fromUserId)
    if (!node) continue

    const referrers = [
      { id: node.l1_referrer_id as string | null, level: 1, rate: Number(node.l1_rate_pct) },
      { id: node.l2_referrer_id as string | null, level: 2, rate: Number(node.l2_rate_pct) },
      { id: node.l3_referrer_id as string | null, level: 3, rate: Number(node.l3_rate_pct) },
    ]

    for (const ref of referrers) {
      if (!ref.id) continue
      let commCents = Math.floor(totals.phpCents * ref.rate / 100)
      if (commCents <= 0) continue
      if (maxCommission !== null) commCents = Math.min(commCents, maxCommission)

      await db.execute(
        `INSERT INTO bg_team_commission
           (beneficiary_id, from_user_id, level, period, currency,
            turnover_cents, ggr_cents, rate_pct, commission_cents,
            fx_rate, php_equivalent_cents, currency_breakdown, status)
         VALUES (?,?,?,?,'PHP', ?,0,?,?,1,?,?,'pending')
         ON DUPLICATE KEY UPDATE
           turnover_cents       = VALUES(turnover_cents),
           commission_cents     = VALUES(commission_cents),
           php_equivalent_cents = VALUES(php_equivalent_cents),
           currency_breakdown   = VALUES(currency_breakdown),
           status               = 'pending'`,
        [
          ref.id, fromUserId, ref.level, date,
          totals.phpCents, ref.rate, commCents,
          commCents, JSON.stringify(totals.breakdown),
        ],
      )
    }
  }

  // 按 beneficiary 汇总入账 bg_team_wallet（乐观锁，最多3次重试）
  const [pending] = await db.query<RowDataPacket[]>(
    `SELECT beneficiary_id, SUM(php_equivalent_cents) AS total_php
     FROM bg_team_commission WHERE period = ? AND status = 'pending'
     GROUP BY beneficiary_id`,
    [date],
  )

  for (const row of pending) {
    const totalPhp  = Number(row.total_php)
    // force 重算时减去已提走的部分，防止重复入账
    const alreadyOut = withdrawnMap.get(String(row.beneficiary_id)) ?? 0
    const creditPhp  = totalPhp - alreadyOut
    if (creditPhp <= 0) continue
    await db.execute(
      `INSERT IGNORE INTO bg_team_wallet (user_id, currency) VALUES (?, 'PHP')`,
      [row.beneficiary_id],
    )
    let settled = false
    for (let i = 0; i < 3; i++) {
      const [[w]] = await db.query<RowDataPacket[]>(
        `SELECT version FROM bg_team_wallet WHERE user_id = ? AND currency = 'PHP'`,
        [row.beneficiary_id],
      )
      const [res] = await db.execute<import('mysql2/promise').ResultSetHeader>(
        `UPDATE bg_team_wallet
         SET available_cents        = available_cents + ?,
             lifetime_earned_cents  = lifetime_earned_cents + ?,
             version                = version + 1
         WHERE user_id = ? AND currency = 'PHP' AND version = ?`,
        [creditPhp, creditPhp, row.beneficiary_id, w.version],
      )
      if (res.affectedRows > 0) { settled = true; break }
    }
    if (!settled) app.log.warn({ beneficiaryId: row.beneficiary_id }, '[daily-settle] wallet update failed after 3 retries')
  }

  // 标记已付
  await db.execute(
    `UPDATE bg_team_commission SET status='paid', paid_at=NOW(3) WHERE period=? AND status='pending'`,
    [date],
  )
  await db.execute(
    `UPDATE bg_team_turnover_daily SET settled=1 WHERE date=?`,
    [date],
  )

  app.log.info({ date, bets: bets.length, beneficiaries: pending.length }, '[daily-settle] done')
}
