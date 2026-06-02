import Router from '@koa/router'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { getMysqlPool } from '../clients/mysql.client.js'
import { ok, fail } from '../utils/response.js'
import { nowIso } from '../utils/format.js'

const router = new Router({ prefix: '/promotions/team' })

// GET /promotions/team/status
router.get('/status', async (ctx) => {
  const userId = ctx.state.userId!
  const db = getMysqlPool(ctx.state.env)

  const [[node], [wallet]] = await Promise.all([
    db.query<RowDataPacket[]>(
      `SELECT opted_in, activated, l1_referrer_id, l2_referrer_id, l3_referrer_id
       FROM bg_team_node WHERE user_id = ? LIMIT 1`,
      [userId],
    ),
    db.query<RowDataPacket[]>(
      `SELECT available_cents, lifetime_earned_cents
       FROM bg_team_wallet WHERE user_id = ? LIMIT 1`,
      [userId],
    ),
  ])

  if (!node.length || !node[0].opted_in) {
    ok(ctx, { isAgent: false, activated: false, l1Count: 0, l2Count: 0, l3Count: 0, availableCents: 0, lifetimeEarnedCents: 0 })
    return
  }

  const [counts] = await db.query<RowDataPacket[]>(
    `SELECT
       SUM(l1_referrer_id = ?) AS l1Count,
       SUM(l2_referrer_id = ?) AS l2Count,
       SUM(l3_referrer_id = ?) AS l3Count
     FROM bg_team_node WHERE activated = 1`,
    [userId, userId, userId],
  )

  ok(ctx, {
    isAgent:              true,
    activated:            !!node[0].activated,
    l1Count:              Number(counts[0]?.l1Count ?? 0),
    l2Count:              Number(counts[0]?.l2Count ?? 0),
    l3Count:              Number(counts[0]?.l3Count ?? 0),
    availableCents:       Number(wallet[0]?.available_cents ?? 0),
    lifetimeEarnedCents:  Number(wallet[0]?.lifetime_earned_cents ?? 0),
  })
})

// POST /promotions/team/enable
router.post('/enable', async (ctx) => {
  const userId = ctx.state.userId!
  const db = getMysqlPool(ctx.state.env)
  const now = nowIso()

  // 查用户三级上线链（注册时已有 inviter_id）
  const [[user]] = await db.query<RowDataPacket[]>(
    `SELECT u.inviter_id AS l1_id, l1.inviter_id AS l2_id, l2.inviter_id AS l3_id
     FROM bg_user u
     LEFT JOIN bg_user l1 ON l1.id = u.inviter_id
     LEFT JOIN bg_user l2 ON l2.id = l1.inviter_id
     WHERE u.id = ? LIMIT 1`,
    [userId],
  )

  if (!user) {
    fail(ctx, 404, 'User not found')
    return
  }

  // INSERT 归属树行（若不存在），或仅更新 opted_in
  await db.execute<ResultSetHeader>(
    `INSERT INTO bg_team_node
       (user_id, l1_referrer_id, l2_referrer_id, l3_referrer_id, opted_in, opted_in_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE opted_in = 1, opted_in_at = COALESCE(opted_in_at, VALUES(opted_in_at))`,
    [userId, user.l1_id ?? null, user.l2_id ?? null, user.l3_id ?? null, now],
  )

  // 确保佣金钱包存在
  await db.execute<ResultSetHeader>(
    `INSERT IGNORE INTO bg_team_wallet (user_id) VALUES (?)`,
    [userId],
  )

  ok(ctx, { isAgent: true })
})

export default router
