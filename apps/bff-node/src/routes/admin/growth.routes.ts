import Router from '@koa/router'
import { getMysqlPool, isMysqlEnabled } from '../../clients/mysql.client.js'
import { nativeTaskTitle } from '../../services/task.service.js'
import { ok, fail } from '../../utils/response.js'
import type { RowDataPacket } from 'mysql2/promise'
import type { Context } from 'koa'

// 任务/成长总览：等级分布、任务参与、签到大盘、奖励成本拆分（全部只读实时查询）
const router = new Router({ prefix: '/growth' })

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_RANGE_DAYS = 92

/** 解析马尼拉日期范围，转成 created_at（UTC 存储）的半开区间 [fromUtc, toUtc) */
function parseRange(ctx: Context): { from: string; to: string; fromUtc: string; toUtc: string } | null {
  const from = String(ctx.query.from ?? '')
  const to = String(ctx.query.to ?? '')
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) { fail(ctx, 400, 'from/to 必须为 YYYY-MM-DD'); return null }
  const fromMs = Date.parse(`${from}T00:00:00+08:00`)
  const toMs = Date.parse(`${to}T00:00:00+08:00`) + 86400_000
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) { fail(ctx, 400, '日期范围无效'); return null }
  if (toMs - fromMs > MAX_RANGE_DAYS * 86400_000) { fail(ctx, 400, `日期范围最多 ${MAX_RANGE_DAYS} 天`); return null }
  const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
  return { from, to, fromUtc: fmt(fromMs), toUtc: fmt(toMs) }
}

// 等级分布：bg_user_vip_state 按币种 GROUP BY current_level
router.get('/overview', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) { ok(ctx, { levels: [], totalUsers: 0, stateUsers: 0 }); return }
  const currency = String(ctx.query.currency ?? 'PHP')
  const pool = getMysqlPool(ctx.state.env)
  const [[levels], [[uc]]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT current_level AS level, COUNT(*) AS users,
              SUM(current_level < awarded_level) AS demoted,
              SUM(turnover_total) AS turnover, SUM(task_growth) AS taskGrowth
       FROM bg_user_vip_state WHERE currency = ?
       GROUP BY current_level ORDER BY current_level`,
      [currency],
    ),
    pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM bg_user`),
  ])
  const rows = levels.map((r) => ({
    level: Number(r.level),
    users: Number(r.users),
    demoted: Number(r.demoted ?? 0),
    turnover: Number(r.turnover ?? 0),
    taskGrowth: Number(r.taskGrowth ?? 0),
  }))
  ok(ctx, {
    levels: rows,
    totalUsers: Number(uc?.total ?? 0),
    // 有该币种成长档案的人数；差值≈从未产生有效流水/任务成长的用户
    stateUsers: rows.reduce((s, r) => s + r.users, 0),
  })
})

// 任务参与：原生任务/社群任务领取聚合 + 签到序列 + 里程碑
router.get('/participation', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) { ok(ctx, { native: [], social: [], checkin: { series: [], milestones: [] }, manualPending: 0 }); return }
  const range = parseRange(ctx)
  if (!range) return
  const currency = ctx.query.currency ? String(ctx.query.currency) : undefined
  const pool = getMysqlPool(ctx.state.env)

  const nativeWhere = currency ? 'AND currency = ?' : ''
  const nativeParams = currency ? [range.fromUtc, range.toUtc, currency] : [range.fromUtc, range.toUtc]
  const [[native], [social], [series], [milestones], [[mr]]] = await Promise.all([
    pool.query<RowDataPacket[]>(
      `SELECT task_id, COUNT(*) AS claims, COUNT(DISTINCT user_id) AS users,
              SUM(CASE WHEN reward_type = 'cash'   THEN reward_amount ELSE 0 END) AS cash,
              SUM(reward_spin) AS spin,
              SUM(CASE WHEN reward_type = 'growth' THEN reward_amount ELSE 0 END) AS growth
       FROM bg_task_claim
       WHERE created_at >= ? AND created_at < ? ${nativeWhere}
       GROUP BY task_id ORDER BY claims DESC`,
      nativeParams,
    ),
    pool.query<RowDataPacket[]>(
      `SELECT sc.task_key, MAX(s.title) AS title, COUNT(*) AS claims,
              MAX(s.reward_type) AS reward_type, MAX(s.reward_amount) AS reward_amount,
              MAX(s.reward_spin) AS reward_spin, MAX(s.currency) AS currency
       FROM bg_task_social_claim sc LEFT JOIN bg_task_social s ON s.task_key = sc.task_key
       WHERE sc.created_at >= ? AND sc.created_at < ?
       GROUP BY sc.task_key ORDER BY claims DESC`,
      [range.fromUtc, range.toUtc],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT checkin_date AS d, COUNT(*) AS users,
              SUM(track = 'enhanced') AS enhanced,
              SUM(base_chances + enh_chances + milestone_chances) AS chances
       FROM bg_checkin_log WHERE checkin_date >= ? AND checkin_date <= ?
       GROUP BY checkin_date ORDER BY checkin_date`,
      [range.from, range.to],
    ),
    pool.query<RowDataPacket[]>(
      `SELECT milestone_days AS days, COUNT(*) AS cnt
       FROM bg_checkin_log
       WHERE checkin_date >= ? AND checkin_date <= ? AND milestone_days > 0
       GROUP BY milestone_days ORDER BY milestone_days`,
      [range.from, range.to],
    ),
    pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS pending FROM bg_task_manual_review WHERE status = 'pending'`),
  ])
  ok(ctx, {
    native: native.map((r) => ({
      taskId: String(r.task_id),
      title: nativeTaskTitle(String(r.task_id)),
      claims: Number(r.claims),
      users: Number(r.users),
      cash: Number(r.cash ?? 0),
      spin: Number(r.spin ?? 0),
      growth: Number(r.growth ?? 0),
    })),
    // 社群任务领取表不落奖励快照，成本按当前配置估算
    social: social.map((r) => ({
      taskKey: String(r.task_key),
      title: String(r.title ?? r.task_key),
      claims: Number(r.claims),
      rewardType: r.reward_type ? String(r.reward_type) : null,
      rewardAmount: Number(r.reward_amount ?? 0),
      rewardSpin: Number(r.reward_spin ?? 0),
      currency: String(r.currency ?? 'PHP'),
    })),
    checkin: {
      series: series.map((r) => ({
        date: new Date(r.d as Date).toLocaleDateString('sv-SE'),
        users: Number(r.users),
        enhanced: Number(r.enhanced ?? 0),
        chances: Number(r.chances ?? 0),
      })),
      milestones: milestones.map((r) => ({ days: Number(r.days), count: Number(r.cnt) })),
    },
    manualPending: Number(mr?.pending ?? 0),
  })
})

// 奖励成本拆分：任务奖励 / VIP 礼金 / 洗码返水（走 bg_wallet_ledger idx_created）
router.get('/cost', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) { ok(ctx, { items: [] }); return }
  const range = parseRange(ctx)
  if (!range) return
  const pool = getMysqlPool(ctx.state.env)
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT type, currency, SUM(amount) AS amount, COUNT(DISTINCT user_id) AS users, COUNT(*) AS entries
     FROM bg_wallet_ledger
     WHERE created_at >= ? AND created_at < ? AND type IN ('task_bonus', 'vip_bonus', 'rebate')
     GROUP BY type, currency ORDER BY type, currency`,
    [range.fromUtc, range.toUtc],
  )
  ok(ctx, {
    items: rows.map((r) => ({
      type: String(r.type),
      currency: String(r.currency ?? 'PHP'),
      amount: Number(r.amount ?? 0),
      users: Number(r.users),
      entries: Number(r.entries),
    })),
  })
})

export default router
