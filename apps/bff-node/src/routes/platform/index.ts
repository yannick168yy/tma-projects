import Router from '@koa/router'
import type { RowDataPacket } from 'mysql2/promise'
import { getPlatformPool } from '../../clients/platform-mysql.client.js'
import { getDefaultRedis } from '../../clients/redis.client.js'
import { platformAuthMiddleware } from '../../middleware/platform-auth.js'
import { loginPlatformAdmin, logoutPlatformAdmin } from '../../services/platform-auth.service.js'
import { invalidateTenantHostCache } from '../../services/tenant.service.js'
import { dropTenantPool } from '../../clients/mysql.client.js'
import { platformRootDomain, refreshDomainCertStatus } from '../../services/domain-cert.service.js'
import { provisionTenant, type ProvisionInput } from '../../services/tenant-provision.service.js'
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

  router.get('/plans', auth, async (ctx) => {
    const [rows] = await getPlatformPool().query<RowDataPacket[]>(
      'SELECT code, name, description FROM pf_plan WHERE enabled = 1 ORDER BY id')
    ok(ctx, rows.map((r) => ({ code: r.code, name: r.name, description: r.description })))
  })

  // 一键开站：建库 → 基线建表 → 种子配置 → 平台库登记 → 冒烟自检
  router.post('/tenants', platformAuthMiddleware('platform_super'), async (ctx) => {
    const b = ctx.request.body as Partial<ProvisionInput>
    if (!b.code || !b.name || !b.adminUsername || !b.adminPassword) {
      return fail(ctx, 400, 'code / name / adminUsername / adminPassword 必填')
    }
    if (!Array.isArray(b.markets) || b.markets.length === 0) return fail(ctx, 400, '至少配置一个市场')
    if (!Array.isArray(b.domains) || b.domains.length === 0) return fail(ctx, 400, '至少配置一个域名')
    if (String(b.adminPassword).length < 10) return fail(ctx, 400, '租户后台密码至少 10 位')

    try {
      const result = await provisionTenant({
        code: String(b.code).trim().toLowerCase(),
        name: String(b.name).trim(),
        markets: b.markets,
        domains: b.domains,
        planCode: String(b.planCode ?? 'standard'),
        adminUsername: String(b.adminUsername).trim(),
        adminPassword: String(b.adminPassword),
        poolMin: b.poolMin,
        poolMax: b.poolMax,
      })
      await invalidateTenantHostCache(getDefaultRedis(ctx.state.env))
      await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'tenant.provision', result.tenantId, {
        code: b.code, database: result.database, tables: result.tables, smokeOk: result.smoke.ok,
      })
      ok(ctx, result)
    } catch (err) {
      // 开站失败的原因必须原样透出：这一步出错时人要能立刻知道卡在哪
      fail(ctx, 400, err instanceof Error ? err.message : '开站失败')
    }
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
      `SELECT id, domain, market, purpose, enabled, app_market, app_priority,
              domain_type, cert_status, cert_expires_at, cert_checked_at, cert_detail, dns_resolved_ip
         FROM pf_tenant_domain WHERE tenant_id = ? ORDER BY purpose, app_priority, domain`, [id])
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
        domainType: d.domain_type, certStatus: d.cert_status,
        certExpiresAt: d.cert_expires_at ? String(d.cert_expires_at) : null,
        certCheckedAt: d.cert_checked_at ? String(d.cert_checked_at) : null,
        certDetail: d.cert_detail, dnsResolvedIp: d.dns_resolved_ip,
      })),
      providers: providers.map((p) => ({ provider: p.provider, agentAccount: p.agent_account, status: p.status })),
      channels: channels.map((c) => ({ channelCode: c.channel_code, owner: c.owner, merchantNo: c.merchant_no, enabled: c.enabled === 1 })),
    })
  })

  // 连接池配置属于平台层资源分配，从业务后台迁过来：
  // 留在业务后台意味着任一租户的 super_admin 都能看到并修改别家租户的连接池
  router.put('/tenants/:id/pool', platformAuthMiddleware('platform_super'), async (ctx) => {
    const id = Number(ctx.params.id)
    const b = ctx.request.body as { poolMin?: unknown; poolMax?: unknown; queueLimit?: unknown }
    const poolMin = Number(b.poolMin)
    const poolMax = Number(b.poolMax)
    const queueLimit = Number(b.queueLimit ?? 0)

    // 上限拍在 100：单租户占满整个 max_connections 会把其他租户全饿死，
    // 分库隔离的意义就没了
    if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 100) return fail(ctx, 400, 'poolMax 需为 1-100 的整数')
    if (!Number.isInteger(poolMin) || poolMin < 0 || poolMin > poolMax) return fail(ctx, 400, 'poolMin 需为 0 到 poolMax 之间的整数')
    if (!Number.isInteger(queueLimit) || queueLimit < 0 || queueLimit > 10000) return fail(ctx, 400, 'queueLimit 需为 0-10000 的整数')

    const pool = getPlatformPool()
    const [[row]] = await pool.query<RowDataPacket[]>(
      'SELECT db_name, pool_min, pool_max, queue_limit FROM pf_tenant WHERE id = ? LIMIT 1', [id]) as unknown as [RowDataPacket[]]
    if (!row) return fail(ctx, 404, '租户不存在')

    await pool.execute(
      'UPDATE pf_tenant SET pool_min = ?, pool_max = ?, queue_limit = ? WHERE id = ?',
      [poolMin, poolMax, queueLimit, id],
    )

    // connectionLimit / maxIdle 在建池时固定，改配置必须丢弃旧池才会生效；
    // 同时清掉域名→租户缓存，否则最长 5 分钟内还在用旧配置的上下文
    const dropped = dropTenantPool(row.db_name)
    await invalidateTenantHostCache(getDefaultRedis(ctx.state.env))
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'tenant.pool', id, {
      from: { min: row.pool_min, max: row.pool_max, queueLimit: row.queue_limit },
      to: { min: poolMin, max: poolMax, queueLimit },
    })
    ok(ctx, { id, poolMin, poolMax, queueLimit, poolRecreated: dropped })
  })

  // ── 域名管理（P1-4）──
  // 子域名走平台泛解析 + 泛域名证书，开站即用；自带域名需客户先配 A 记录再签发。
  router.post('/tenants/:id/domains', platformAuthMiddleware('platform_super'), async (ctx) => {
    const tenantId = Number(ctx.params.id)
    const b = ctx.request.body as { domain?: unknown; market?: unknown; purpose?: unknown; type?: unknown }
    const purpose = String(b.purpose ?? 'site')
    const market = String(b.market ?? '')
    const type = b.type === 'platform_subdomain' ? 'platform_subdomain' : 'custom'
    if (!['site', 'admin', 'app_route', 'landing'].includes(purpose)) return fail(ctx, 400, '非法 purpose')
    if (!market) return fail(ctx, 400, 'market 必填')

    const pool = getPlatformPool()
    const [[tenant]] = await pool.query<RowDataPacket[]>(
      'SELECT code FROM pf_tenant WHERE id = ? LIMIT 1', [tenantId]) as unknown as [RowDataPacket[]]
    if (!tenant) return fail(ctx, 404, '租户不存在')

    // 子域名由平台按租户代号生成，不接受调用方指定 —— 否则可以借这个口子
    // 抢注别家的子域名，或者写出不在泛解析覆盖范围内的域名
    const domain = type === 'platform_subdomain'
      ? `${purpose === 'admin' ? 'admin.' : ''}${tenant.code}.${platformRootDomain()}`
      : String(b.domain ?? '').trim().toLowerCase().replace(/^www\./, '')
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return fail(ctx, 400, '域名格式不合法')

    const [dup] = await pool.query<RowDataPacket[]>(
      'SELECT tenant_id FROM pf_tenant_domain WHERE domain = ? LIMIT 1', [domain])
    if (dup[0]) return fail(ctx, 400, '该域名已被占用')

    // 子域名落在泛域名证书覆盖范围内，直接算已签发；自带域名要等 DNS 生效
    const certStatus = type === 'platform_subdomain' ? 'issued' : 'pending_dns'
    const [res] = await pool.execute(
      `INSERT INTO pf_tenant_domain (tenant_id, domain, market, purpose, domain_type, cert_status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tenantId, domain, market, purpose, type, certStatus])
    await invalidateTenantHostCache(getDefaultRedis(ctx.state.env))
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'domain.add', tenantId, { domain, purpose, type })
    ok(ctx, { id: (res as { insertId: number }).insertId, domain, certStatus })
  })

  router.delete('/tenants/:id/domains/:domainId', platformAuthMiddleware('platform_super'), async (ctx) => {
    const tenantId = Number(ctx.params.id)
    const domainId = Number(ctx.params.domainId)
    const pool = getPlatformPool()
    const [[row]] = await pool.query<RowDataPacket[]>(
      'SELECT domain, purpose FROM pf_tenant_domain WHERE id = ? AND tenant_id = ? LIMIT 1',
      [domainId, tenantId]) as unknown as [RowDataPacket[]]
    if (!row) return fail(ctx, 404, '域名不存在')

    // 删掉最后一个 site 域名 = 该租户前台彻底无法访问，这种误操作要挡住
    if (row.purpose === 'site') {
      const [[cnt]] = await pool.query<RowDataPacket[]>(
        "SELECT COUNT(*) AS n FROM pf_tenant_domain WHERE tenant_id = ? AND purpose = 'site' AND enabled = 1",
        [tenantId]) as unknown as [RowDataPacket[]]
      if (Number(cnt.n) <= 1) return fail(ctx, 400, '不能删除最后一个站点域名')
    }

    await pool.execute('DELETE FROM pf_tenant_domain WHERE id = ?', [domainId])
    await invalidateTenantHostCache(getDefaultRedis(ctx.state.env))
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'domain.remove', tenantId, { domain: row.domain })
    ok(ctx, { id: domainId })
  })

  // 巡检：只读探测 DNS 与证书并回写状态，不签发、不改 nginx
  router.post('/domains/probe', auth, async (ctx) => {
    const b = ctx.request.body as { domainIds?: unknown }
    const ids = Array.isArray(b.domainIds) ? b.domainIds.map(Number).filter(Number.isInteger) : undefined
    const probes = await refreshDomainCertStatus(ids)
    ok(ctx, probes)
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
