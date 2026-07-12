import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import { getMysqlPool, isMysqlEnabled } from '../../clients/mysql.client.js'
import { fail, ok } from '../../utils/response.js'

const router = new Router({ prefix: '/ledger' })

router.get('/', async (ctx) => {
  if (!isMysqlEnabled(ctx.state.env)) {
    ok(ctx, { total: 0, items: [], page: 1, pageSize: 20 })
    return
  }

  const pageValue = Number(ctx.query.page ?? 1)
  const pageSizeValue = Number(ctx.query.pageSize ?? 20)
  const page = Number.isFinite(pageValue) ? Math.max(1, Math.floor(pageValue)) : 1
  const pageSize = Number.isFinite(pageSizeValue) ? Math.min(1000, Math.max(10, Math.floor(pageSizeValue))) : 20
  const userId = ctx.query.userId ? String(ctx.query.userId).trim() : ''
  const type = ctx.query.type ? String(ctx.query.type) : ''
  const currency = ctx.query.currency ? String(ctx.query.currency).trim().toUpperCase() : ''
  const from = ctx.query.from ? String(ctx.query.from) : ''
  const to = ctx.query.to ? String(ctx.query.to) : ''

  const where: string[] = []
  const params: unknown[] = []
  if (userId) {
    where.push('user_id = ?')
    params.push(userId)
  }
  if (type) {
    where.push('type = ?')
    params.push(type)
  }
  if (currency) {
    where.push('currency = ?')
    params.push(currency)
  }
  if (from) {
    where.push('created_at >= ?')
    params.push(from)
  }
  if (to) {
    where.push('created_at <= ?')
    params.push(to)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const offset = (page - 1) * pageSize
  const pool = getMysqlPool(ctx.state.env)

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, user_id, type, currency, amount, balance_after, ref_type, ref_id, description, trace_id, created_at
       FROM bg_wallet_ledger
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )
    const [[countRow]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM bg_wallet_ledger ${whereSql}`,
      params,
    )
    ok(ctx, {
      total: Number(countRow?.total ?? 0),
      page,
      pageSize,
      items: rows.map((r) => ({
        id: String(r.id),
        userId: String(r.user_id),
        type: String(r.type),
        currency: String(r.currency ?? 'PHP'),
        amount: Number(r.amount),
        balanceAfter: Number(r.balance_after),
        refType: r.ref_type == null ? null : String(r.ref_type),
        refId: r.ref_id == null ? null : String(r.ref_id),
        description: String(r.description ?? ''),
        traceId: r.trace_id == null ? null : String(r.trace_id),
        createdAt: new Date(r.created_at as Date).toISOString(),
      })),
    })
  } catch (e) {
    fail(ctx, 500, e instanceof Error ? e.message : '查询账变失败', 500)
  }
})

export default router
