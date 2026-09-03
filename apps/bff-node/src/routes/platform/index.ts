import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../../clients/platform-mysql.client.js'
import { getDefaultRedis } from '../../clients/redis.client.js'
import { platformAuthMiddleware } from '../../middleware/platform-auth.js'
import { loginPlatformAdmin, logoutPlatformAdmin } from '../../services/platform-auth.service.js'
import { invalidateTenantHostCache } from '../../services/tenant.service.js'
import { ok, fail } from '../../utils/response.js'

/**
 * 平台控制台 API。与 /admin（租户后台）完全分离：
 * 页面零重叠、会话零重叠、权限模型零重叠。
 */
export function createPlatformRouter(): Router {
  const router = new Router({ prefix: '/platform' })

  router.post('/auth/login', async (ctx) => {
    const body = ctx.request.body as { username?: string; password?: string }
    if (!body.username || !body.password) return fail(ctx, 400, '账号与密码必填')
    const res = await loginPlatformAdmin(getDefaultRedis(ctx.state.env), body.username, body.password)
    // 不区分「账号不存在」与「密码错误」，避免账号枚举
    if (!res) return fail(ctx, 401, '账号或密码错误', 401)
    ok(ctx, res)
  })

  const auth = platformAuthMiddleware()

  router.post('/auth/logout', auth, async (ctx) => {
    await logoutPlatformAdmin(getDefaultRedis(ctx.state.env), ctx.get('Authorization').slice(7))
    ok(ctx, { ok: true })
  })

  router.get('/auth/me', auth, async (ctx) => {
    const s = ctx.state.platformAdmin!
    ok(ctx, { id: s.adminId, username: s.username, role: s.role })
  })

  router.get('/tenants', auth, async (ctx) => {
    const [rows] = await getPlatformPool().query<RowDataPacket[]>(
      `SELECT t.id, t.code, t.name, t.db_name, t.status, t.self_operated, t.created_at,
              p.name AS plan_name,
              (SELECT COUNT(*) FROM pf_tenant_market m WHERE m.tenant_id = t.id) AS market_count,
              (SELECT COUNT(*) FROM pf_tenant_domain d WHERE d.tenant_id = t.id) AS domain_count
         FROM pf_tenant t
         LEFT JOIN pf_tenant_plan tp ON tp.tenant_id = t.id AND tp.ended_at IS NULL
         LEFT JOIN pf_plan p ON p.id = tp.plan_id
        ORDER BY t.id`,
    )
    ok(ctx, rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      database: r.db_name,
      status: r.status,
      selfOperated: r.self_operated === 1,
      planName: r.plan_name ?? null,
      marketCount: Number(r.market_count),
      domainCount: Number(r.domain_count),
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    })))
  })

  router.get('/tenants/:id', auth, async (ctx) => {
    const id = Number(ctx.params.id)
    const pool = getPlatformPool()
    const [[tenant]] = await pool.query<RowDataPacket[]>(
      `SELECT t.*, p.name AS plan_name, p.code AS plan_code
         FROM pf_tenant t
         LEFT JOIN pf_tenant_plan tp ON tp.tenant_id = t.id AND tp.ended_at IS NULL
         LEFT JOIN pf_plan p ON p.id = tp.plan_id
        WHERE t.id = ? LIMIT 1`, [id]) as unknown as [RowDataPacket[]]
    if (!tenant) return fail(ctx, 404, '租户不存在')

    const [markets] = await pool.query<RowDataPacket[]>(
      'SELECT market, currency, timezone, enabled FROM pf_tenant_market WHERE tenant_id = ? ORDER BY market', [id])
    const [domains] = await pool.query<RowDataPacket[]>(
      'SELECT id, domain, market, purpose, enabled, app_market, app_priority FROM pf_tenant_domain WHERE tenant_id = ? ORDER BY purpose, app_priority, domain', [id])
    const [providers] = await pool.query<RowDataPacket[]>(
      'SELECT provider, agent_account, status FROM pf_tenant_provider WHERE tenant_id = ?', [id])
    const [channels] = await pool.query<RowDataPacket[]>(
      'SELECT channel_code, owner, merchant_no, enabled FROM pf_tenant_channel WHERE tenant_id = ? ORDER BY sort_order', [id])

    ok(ctx, {
      id: tenant.id,
      code: tenant.code,
      name: tenant.name,
      database: tenant.db_name,
      status: tenant.status,
      selfOperated: tenant.self_operated === 1,
      remark: tenant.remark,
      planName: tenant.plan_name ?? null,
      planCode: tenant.plan_code ?? null,
      pool: { min: tenant.pool_min, max: tenant.pool_max, queueLimit: tenant.queue_limit },
      createdAt: String(tenant.created_at),
      markets: markets.map((m) => ({ market: m.market, currency: m.currency, timezone: m.timezone, enabled: m.enabled === 1 })),
      domains: domains.map((d) => ({
        id: d.id, domain: d.domain, market: d.market, purpose: d.purpose,
        enabled: d.enabled === 1, appMarket: d.app_market, appPriority: d.app_priority,
      })),
      providers: providers.map((p) => ({ provider: p.provider, agentAccount: p.agent_account, status: p.status })),
      channels: channels.map((c) => ({ channelCode: c.channel_code, owner: c.owner, merchantNo: c.merchant_no, enabled: c.enabled === 1 })),
    })
  })

  // 状态机：欠费按 正常 → 停提现 → 停充值 → 停站 逐级降级；关站是终态
  const STATUS_FLOW: Record<string, string[]> = {
    trial: ['active', 'suspended', 'closed'],
    active: ['trial', 'withdraw_suspended', 'deposit_suspended', 'suspended', 'closed'],
    withdraw_suspended: ['active', 'deposit_suspended', 'suspended', 'closed'],
    deposit_suspended: ['active', 'withdraw_suspended', 'suspended', 'closed'],
    suspended: ['active', 'closed'],
    closed: [],
  }

  router.put('/tenants/:id/status', platformAuthMiddleware('platform_super', 'platform_ops'), async (ctx) => {
    const id = Number(ctx.params.id)
    const next = String((ctx.request.body as { status?: unknown }).status ?? '')
    const pool = getPlatformPool()
    const [[row]] = await pool.query<RowDataPacket[]>(
      'SELECT status, self_operated, db_name FROM pf_tenant WHERE id = ? LIMIT 1', [id]) as unknown as [RowDataPacket[]]
    if (!row) return fail(ctx, 404, '租户不存在')
    // 自营站不参与停站流程：把它停了等于把整个平台自己关了
    if (row.self_operated === 1) return fail(ctx, 400, '自营站不允许改状态')
    const allowed = STATUS_FLOW[row.status] ?? []
    if (!allowed.includes(next)) return fail(ctx, 400, `不允许从 ${row.status} 变更为 ${next}`)

    await pool.execute('UPDATE pf_tenant SET status = ? WHERE id = ?', [next, id])
    // 状态变了要立刻让缓存失效，否则最长 5 分钟内旧状态还在放行
    await invalidateTenantHostCache(getDefaultRedis(ctx.state.env))
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'tenant.status', id, { from: row.status, to: next })
    ok(ctx, { id, status: next })
  })

  return router
}

/** 平台侧所有写操作都要留痕：包网运营出纠纷时这是唯一的事实依据 */
async function writeAudit(
  adminId: number | null,
  ip: string,
  action: string,
  tenantId: number | null,
  detail: unknown,
): Promise<void> {
  await getPlatformPool().execute(
    'INSERT INTO pf_audit_log (admin_id, tenant_id, action, detail, ip) VALUES (?, ?, ?, ?, ?)',
    [adminId, tenantId, action, JSON.stringify(detail), ip],
  ).catch(() => { /* 审计写失败不阻断业务；失败本身会进服务日志 */ })
}
