import Router from '@koa/router'
import { getLedgerEntry, listLedger } from '../services/store.js'
import { getMysqlPool, isMysqlEnabled } from '../clients/mysql.client.js'
import { fail, ok } from '../utils/response.js'
import type { RowDataPacket } from 'mysql2/promise'

const router = new Router({ prefix: '/ledger' })

const PHT_OFFSET_MS = 8 * 60 * 60 * 1000

// dateFrom 是 PHT(+8) 日历日, created_at 存 UTC, 按 PHT 日起点换算成 UTC 实例再比较
function phtDateStartUtc(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d) - PHT_OFFSET_MS)
}

router.get('/', async (ctx) => {
  const pageValue = Number(ctx.query.page ?? 1)
  const page = Number.isFinite(pageValue) ? Math.max(1, Math.floor(pageValue)) : 1
  const type = String(ctx.query.type ?? 'all')
  const types = String(ctx.query.types ?? '').split(',').map((v) => v.trim()).filter(Boolean)
  const dateFrom = ctx.query.dateFrom ? String(ctx.query.dateFrom) : ''
  const pageSize = 20
  if (isMysqlEnabled(ctx.state.env)) {
    const where = ['user_id = ?']
    const params: unknown[] = [ctx.state.userId!]
    if (types.length > 0) {
      where.push(`type IN (${types.map(() => '?').join(', ')})`)
      params.push(...types)
    } else if (type !== 'all') {
      where.push('type = ?')
      params.push(type)
    }
    if (dateFrom) {
      where.push('created_at >= ?')
      params.push(phtDateStartUtc(dateFrom))
    } else {
      where.push('created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)')
    }
    const offset = (page - 1) * pageSize
    const pool = getMysqlPool(ctx.state.env)
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, type, currency, amount, balance_after, description, created_at
       FROM bg_wallet_ledger
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, offset],
    )
    const [[countRow]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM bg_wallet_ledger WHERE ${where.join(' AND ')}`,
      params,
    )
    ok(ctx, {
      items: rows.map((r) => ({
        id: String(r.id),
        type: String(r.type),
        currency: String(r.currency ?? 'PHP'),
        amount: Number(r.amount),
        balanceAfter: Number(r.balance_after),
        description: String(r.description ?? ''),
        createdAt: new Date(r.created_at as Date).toISOString(),
      })),
      total: Number(countRow?.total ?? 0),
      page,
      pageSize,
    })
    return
  }

  const limit = 200
  let items = await listLedger(ctx.state.redis, ctx.state.userId!, limit)
  const since = dateFrom ? phtDateStartUtc(dateFrom).getTime() : Date.now() - 7 * 24 * 60 * 60 * 1000
  items = items.filter((e) => new Date(e.createdAt).getTime() >= since)
  if (types.length > 0) {
    items = items.filter((e) => types.includes(e.type))
  } else if (type !== 'all') {
    items = items.filter((e) => e.type === type)
  }
  const start = (page - 1) * pageSize
  ok(ctx, {
    items: items.slice(start, start + pageSize).map((e) => ({
      id: e.id,
      type: e.type,
      currency: e.currency ?? 'PHP',
      amount: e.amount,
      balanceAfter: e.balanceAfter,
      description: e.description,
      createdAt: e.createdAt,
    })),
    total: items.length,
    page,
    pageSize,
  })
})

router.get('/:id', async (ctx) => {
  const entry = await getLedgerEntry(ctx.state.redis, ctx.state.userId!, ctx.params.id)
  if (!entry) {
    fail(ctx, 404, 'Ledger entry not found', 404)
    return
  }
  ok(ctx, entry)
})

export default router
