import Router from '@koa/router'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { getPlatformPool } from '../../clients/platform-mysql.client.js'
import { requireRole } from '../../middleware/require-role.js'
import { dropTenantPool } from '../../clients/mysql.client.js'
import { invalidateTenantHostCache } from '../../services/tenant.service.js'
import { ok, fail } from '../../utils/response.js'

// 租户与连接池配置属于平台层，只有 super_admin 能看能改。
// P1 建出独立的平台后台后，这组接口整体迁过去。
const router = new Router({ prefix: '/tenants' })

interface TenantRow extends RowDataPacket {
  id: number
  code: string
  name: string
  db_name: string
  status: string
  self_operated: number
  pool_min: number
  pool_max: number
  queue_limit: number
}

router.get('/', requireRole('super_admin', '仅 super_admin 可查看租户'), async (ctx) => {
  const [rows] = await getPlatformPool().query<TenantRow[]>(
    `SELECT t.id, t.code, t.name, t.db_name, t.status, t.self_operated,
            t.pool_min, t.pool_max, t.queue_limit,
            (SELECT COUNT(*) FROM pf_tenant_domain d WHERE d.tenant_id = t.id) AS domain_count
       FROM pf_tenant t ORDER BY t.id`,
  )
  ok(ctx, rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    database: row.db_name,
    status: row.status,
    selfOperated: row.self_operated === 1,
    poolMin: row.pool_min,
    poolMax: row.pool_max,
    queueLimit: row.queue_limit,
    domainCount: Number((row as unknown as { domain_count: number }).domain_count),
  })))
})

router.put('/:id/pool', requireRole('super_admin', '仅 super_admin 可调整连接池'), async (ctx) => {
  const id = Number(ctx.params.id)
  const body = ctx.request.body as { poolMin?: unknown; poolMax?: unknown; queueLimit?: unknown }
  const poolMin = Number(body.poolMin)
  const poolMax = Number(body.poolMax)
  const queueLimit = Number(body.queueLimit ?? 0)

  // 上限拍在 100：单租户占满整个 max_connections 会把其他租户全饿死，
  // 分库隔离的意义就没了
  if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 100) return fail(ctx, 400, 'poolMax 需为 1-100 的整数')
  if (!Number.isInteger(poolMin) || poolMin < 0 || poolMin > poolMax) return fail(ctx, 400, 'poolMin 需为 0 到 poolMax 之间的整数')
  if (!Number.isInteger(queueLimit) || queueLimit < 0 || queueLimit > 10000) return fail(ctx, 400, 'queueLimit 需为 0-10000 的整数')

  const [rows] = await getPlatformPool().query<TenantRow[]>('SELECT db_name FROM pf_tenant WHERE id = ?', [id])
  if (!rows[0]) return fail(ctx, 404, '租户不存在')

  const [res] = await getPlatformPool().execute<ResultSetHeader>(
    'UPDATE pf_tenant SET pool_min = ?, pool_max = ?, queue_limit = ? WHERE id = ?',
    [poolMin, poolMax, queueLimit, id],
  )
  if (res.affectedRows === 0) return fail(ctx, 404, '租户不存在')

  // connectionLimit / maxIdle 在建池时固定，改配置必须丢弃旧池才会生效；
  // 同时清掉域名→租户缓存，否则最长 5 分钟内还在用旧配置的上下文
  const dropped = dropTenantPool(rows[0].db_name)
  await invalidateTenantHostCache(ctx.state.redis)

  ok(ctx, { id, poolMin, poolMax, queueLimit, poolRecreated: dropped })
})

export default router
