import Router from '@koa/router'
import { ok, fail } from '../../utils/response.js'
import {
  getVipBenefits,
  saveVipBenefits,
  runWeeklyNegativeRebate,
  MAX_VIP_LEVEL,
} from '../../services/vip.service.js'
import { getMysqlPool, isMysqlEnabled } from '../../clients/mysql.client.js'
import type { RowDataPacket } from 'mysql2/promise'

const router = new Router({ prefix: '/vip' })

function fmtDateTime(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().replace('T', ' ').slice(0, 19)
  return String(value).replace('T', ' ').slice(0, 19)
}

// GET /admin/vip/benefits — 各级权益配置
router.get('/benefits', async (ctx) => {
  const benefits = await getVipBenefits(ctx.state.env)
  ok(ctx, { benefits })
})

// PUT /admin/vip/benefits — 保存各级权益配置
router.put('/benefits', async (ctx) => {
  const body = ctx.request.body as {
    benefits?: {
      level: number
      promotionBonus: number
      weeklySalary: number
      monthlySalary: number
      negativeRebatePct: number
      retentionLine: number
    }[]
  }
  if (!Array.isArray(body.benefits) || body.benefits.length === 0) {
    fail(ctx, 400, 'benefits array required')
    return
  }
  const numFields = ['promotionBonus', 'weeklySalary', 'monthlySalary', 'negativeRebatePct', 'retentionLine'] as const
  for (const it of body.benefits) {
    if (!Number.isInteger(it.level) || it.level < 1 || it.level > MAX_VIP_LEVEL) {
      fail(ctx, 400, `invalid level ${it.level}`)
      return
    }
    for (const f of numFields) {
      if (typeof it[f] !== 'number' || it[f] < 0) {
        fail(ctx, 400, `invalid ${f} for L${it.level}`)
        return
      }
    }
    if (it.negativeRebatePct > 100) {
      fail(ctx, 400, `negativeRebatePct out of range for L${it.level}`)
      return
    }
  }
  await saveVipBenefits(ctx.state.env, body.benefits)
  ok(ctx, { saved: body.benefits.length })
})

// POST /admin/vip/negative-rebate/manual — 手动结算负盈利返水
//   body.includeCurrentWeek=true 结算本周至今（测试用），否则结算上一整周
router.post('/negative-rebate/manual', async (ctx) => {
  const body = (ctx.request.body ?? {}) as { includeCurrentWeek?: boolean }
  const result = await runWeeklyNegativeRebate(ctx.state.env, { includeCurrentWeek: Boolean(body.includeCurrentWeek) })
  ok(ctx, result)
})

// GET /admin/vip/records — VIP 礼金发放记录列表
router.get('/records', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) { ok(ctx, { items: [], total: 0 }); return }
  const pool = getMysqlPool(ctx.state.env)
  const page = Math.max(1, Number(ctx.query.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Number(ctx.query.pageSize ?? 50)))
  const typeFilter = ctx.query.type ? String(ctx.query.type) : undefined
  const userFilter = ctx.query.userId ? String(ctx.query.userId) : undefined

  const where: string[] = []
  const params: unknown[] = []
  if (typeFilter) { where.push('vr.type = ?'); params.push(typeFilter) }
  if (userFilter) { where.push('vr.user_id = ?'); params.push(userFilter) }
  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const [[{ total }]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM bg_vip_reward_log vr ${whereClause}`,
    params,
  )
  const [items] = await pool.query<RowDataPacket[]>(
    `SELECT vr.id, vr.user_id, u.display_name, vr.level, vr.type, vr.amount,
            vr.currency_code, vr.period_key, vr.status, vr.created_at, vr.paid_at
     FROM bg_vip_reward_log vr
     LEFT JOIN bg_user u ON u.id = vr.user_id
     ${whereClause}
     ORDER BY vr.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  )
  ok(ctx, {
    items: items.map((r) => ({
      id: Number(r.id),
      userId: String(r.user_id),
      displayName: r.display_name ? String(r.display_name) : null,
      level: Number(r.level),
      type: String(r.type),
      amount: Number(r.amount),
      currencyCode: String(r.currency_code),
      periodKey: String(r.period_key),
      status: String(r.status),
      createdAt: fmtDateTime(r.created_at),
      paidAt: fmtDateTime(r.paid_at),
    })),
    total: Number(total),
    page,
    pageSize,
  })
})

export default router
