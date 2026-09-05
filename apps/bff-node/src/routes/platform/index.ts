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
import { randomUUID } from 'node:crypto'
import { issueImpersonateTicket } from '../../services/impersonate.service.js'
import {
  deletePlanOverride,
  invalidatePlanLimitCache,
  isLimitKey,
  LIMIT_KEYS,
  listPlanOverrides,
  setPlanOverride,
} from '../../services/plan-limit.service.js'
import { readFile } from 'node:fs/promises'
import {
  countTenantI18n,
  deleteTenantI18n,
  invalidateTenantI18nCache,
  isSupportedLocale,
  listTenantI18n,
  MAX_OVERRIDES_PER_TENANT,
  setTenantI18n,
  SUPPORTED_LOCALES,
} from '../../services/tenant-i18n.service.js'
import { runWithTenant } from '../../lib/tenant-context.js'
import { tenantById } from '../../services/tenant.service.js'
import { getStorageProvider } from '../../services/storage/index.js'
import { parseImageDataUrl } from '../../services/home-content.service.js'
import {
  DEFAULT_BRAND,
  getTenantBrandRaw,
  invalidateTenantBrandCache,
  saveTenantBrand,
  THEME_KEYS,
  validateThemeValue,
  type BrandUpdate,
  type ThemeKey,
} from '../../services/brand.service.js'
import {
  FEATURE_KEYS,
  getPlanDefaults,
  getTenantFeatures,
  invalidateTenantFeatureCache,
  isFeatureKey,
  listTenantOverrides,
  setTenantOverride,
} from '../../services/tenant-feature.service.js'
import {
  listTenantProviders,
  saveTenantProvider,
  syncProviderToTenantDb,
  listTenantChannels,
  saveTenantChannel,
  deleteTenantChannel,
  syncChannelsToTenantDb,
} from '../../services/tenant-integration.service.js'
import { credentialKeyConfigured } from '../../services/platform-credential.service.js'
import {
  listTenantApps,
  saveTenantApp,
  deleteTenantApp,
  validateTenantApp,
  type TenantAppBuild,
} from '../../services/tenant-app.service.js'
import { ok, fail } from '../../utils/response.js'

/**
 * 平台控制台 API。与 /admin（租户后台）完全分离：
 * 页面零重叠、会话零重叠、权限模型零重叠。
 */
/**
 * key 目录。容器里通过 infra/database 同一个挂载点拿到 infra/i18n。
 * 进程内缓存：文件是构建产物，运行期不会变；读不到就让接口报 503 而不是静默返回空目录，
 * 空目录会让人以为「一条 key 都没有」而不是「产物没生成」。
 */
let i18nCatalog: Record<string, string> | null | undefined
async function loadI18nCatalog(): Promise<Record<string, string> | null> {
  if (i18nCatalog !== undefined) return i18nCatalog
  try {
    const path = process.env.I18N_KEYS_PATH ?? '/app/infra/i18n/keys.en.json'
    i18nCatalog = JSON.parse(await readFile(path, 'utf8')) as Record<string, string>
  } catch {
    i18nCatalog = null
  }
  return i18nCatalog
}

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
              domain_type, cert_status, cert_expires_at, cert_checked_at, cert_detail, dns_resolved_ip,
              acme_enabled, cert_issued_at, cert_last_error
         FROM pf_tenant_domain WHERE tenant_id = ? ORDER BY purpose, app_priority, domain`, [id])
    const [providers, channels] = await Promise.all([
      listTenantProviders(id),
      listTenantChannels(id),
    ])

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
        acmeEnabled: d.acme_enabled === 1,
        certIssuedAt: d.cert_issued_at ? String(d.cert_issued_at) : null,
        certLastError: d.cert_last_error,
      })),
      providers,
      channels,
      // 没配主密钥就不让后台以为能存密钥：表单里据此禁用密钥输入并给出提示
      credentialKeyReady: credentialKeyConfigured(),
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

  // ── impersonate（P1-6）──
  // 平台后台签发一次性票据 → 跳转租户后台域名 → 那边兑换成租户会话。
  // 不直接下发租户 token：平台域名与租户域名不同源，token 传不过去；
  // 且票据 60 秒即焚，比把一个 8 小时的后台 token 塞进 URL 安全得多。
  router.post('/tenants/:id/impersonate', platformAuthMiddleware('platform_super'), async (ctx) => {
    const id = Number(ctx.params.id)
    const tenant = await tenantById(id)
    if (!tenant) return fail(ctx, 404, '租户不存在')
    if (tenant.status === 'closed') return fail(ctx, 400, '已关站的租户不可登录')

    const [[domain]] = await getPlatformPool().query<RowDataPacket[]>(
      `SELECT domain FROM pf_tenant_domain
        WHERE tenant_id = ? AND purpose = 'admin' AND enabled = 1 ORDER BY id LIMIT 1`,
      [id]) as unknown as [RowDataPacket[]]
    if (!domain) return fail(ctx, 400, '该租户没有登记业务后台域名（purpose=admin）')

    const admin = ctx.state.platformAdmin
    const { ticket, expiresIn } = await issueImpersonateTicket(ctx.state.env, {
      tenantId: id,
      platformAdminId: admin?.adminId ?? null,
      platformUsername: admin?.username ?? 'unknown',
    })
    await writeAudit(admin?.adminId ?? null, ctx.ip, 'tenant.impersonate.issue', id,
      { domain: String(domain.domain) })
    ok(ctx, {
      url: `https://${String(domain.domain)}/admin-panel/impersonate?ticket=${ticket}`,
      expiresIn,
    })
  })

  // ── 套餐可覆盖范围（P1-14）──
  // 区间是「租户后台能把这个参数改到多少」的边界，不是默认值。
  // 未登记的 key 一律放行 —— 白名单语义：平台没表态就是不管。
  router.get('/plans/:id/overrides', platformAuthMiddleware(), async (ctx) => {
    const planId = Number(ctx.params.id)
    const [[plan]] = await getPlatformPool().query<RowDataPacket[]>(
      'SELECT id, code, name FROM pf_plan WHERE id = ? LIMIT 1', [planId]) as unknown as [RowDataPacket[]]
    if (!plan) return fail(ctx, 404, '套餐不存在')
    ok(ctx, {
      plan: { id: plan.id, code: plan.code, name: plan.name },
      keys: Object.entries(LIMIT_KEYS).map(([key, label]) => ({ key, label })),
      overrides: await listPlanOverrides(planId),
    })
  })

  router.put('/plans/:id/overrides/:key', platformAuthMiddleware('platform_super'), async (ctx) => {
    const planId = Number(ctx.params.id)
    const key = String(ctx.params.key)
    if (!isLimitKey(key)) return fail(ctx, 400, '未知的配置项')
    const b = ctx.request.body as { min?: unknown; max?: unknown }

    const parse = (raw: unknown): number | null | undefined => {
      if (raw === null || raw === '' || raw === undefined) return null
      const n = Number(raw)
      return Number.isFinite(n) ? n : undefined
    }
    const min = parse(b.min)
    const max = parse(b.max)
    if (min === undefined || max === undefined) return fail(ctx, 400, 'min / max 需为数字或留空')
    // 区间反了会让所有取值都被拒，且报错信息看起来像配置项本身有问题，很难查
    if (min !== null && max !== null && min > max) return fail(ctx, 400, 'min 不能大于 max')

    const [[plan]] = await getPlatformPool().query<RowDataPacket[]>(
      'SELECT id FROM pf_plan WHERE id = ? LIMIT 1', [planId]) as unknown as [RowDataPacket[]]
    if (!plan) return fail(ctx, 404, '套餐不存在')

    if (min === null && max === null) await deletePlanOverride(planId, key)
    else await setPlanOverride(planId, key, min, max)

    // 套餐改了要清掉挂这个套餐的所有租户的缓存。租户数少，全清最省事也最不容易漏
    await invalidatePlanLimitCache(ctx.state.env)
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'plan.override', planId, { key, min, max })
    ok(ctx, { planId, key, min, max })
  })

  // ── 文案覆盖（P1-11）──
  // key 目录来自 infra/i18n/keys.en.json（scripts/dump-i18n-keys.mjs 生成）。
  // i18n 词条定义在 apps/web-tma 里，BFF 与平台控制台都读不到它的源码，
  // 与其让 BFF 反向依赖前台源码，不如像 schema_baseline 那样产出一份显式产物。
  router.get('/i18n/keys', platformAuthMiddleware(), async (ctx) => {
    const catalog = await loadI18nCatalog()
    if (!catalog) return fail(ctx, 503, 'key 目录未生成，请先跑 scripts/dump-i18n-keys.mjs')
    const q = String(ctx.query.q ?? '').trim().toLowerCase()
    const entries = Object.entries(catalog)
      .filter(([k, v]) => !q || k.toLowerCase().includes(q) || v.toLowerCase().includes(q))
      .slice(0, 200)
      .map(([key, defaultValue]) => ({ key, defaultValue }))
    ok(ctx, { total: Object.keys(catalog).length, matched: entries.length, entries })
  })

  router.get('/tenants/:id/i18n', platformAuthMiddleware(), async (ctx) => {
    const id = Number(ctx.params.id)
    if (!(await tenantById(id))) return fail(ctx, 404, '租户不存在')
    const locale = isSupportedLocale(ctx.query.locale) ? String(ctx.query.locale) : undefined
    const search = String(ctx.query.q ?? '').trim() || undefined
    const [rows, total] = await Promise.all([
      listTenantI18n(id, locale, search),
      countTenantI18n(id),
    ])
    ok(ctx, { locales: SUPPORTED_LOCALES, rows, total, max: MAX_OVERRIDES_PER_TENANT })
  })

  router.put('/tenants/:id/i18n', platformAuthMiddleware('platform_super'), async (ctx) => {
    const id = Number(ctx.params.id)
    if (!(await tenantById(id))) return fail(ctx, 404, '租户不存在')
    const b = ctx.request.body as { locale?: unknown; keyPath?: unknown; value?: unknown }
    if (!isSupportedLocale(b.locale)) return fail(ctx, 400, 'locale 不支持')
    const keyPath = String(b.keyPath ?? '').trim()
    // 键形如 checkin.title：限死字符集，免得写进去一个前端永远匹配不到的怪键
    if (!/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/.test(keyPath) || keyPath.length > 191) {
      return fail(ctx, 400, 'keyPath 需为点号分隔的字母数字下划线')
    }
    if (typeof b.value !== 'string') return fail(ctx, 400, 'value 需为字符串')
    if (b.value.length > 2000) return fail(ctx, 400, 'value 不能超过 2000 字')

    // 上限拦在写入前：bootstrap 每次页面加载都会带上全部覆盖，放任增长会拖慢首屏
    const existing = await listTenantI18n(id, String(b.locale))
    const isNew = !existing.some((r) => r.keyPath === keyPath)
    if (isNew && (await countTenantI18n(id)) >= MAX_OVERRIDES_PER_TENANT) {
      return fail(ctx, 400, `覆盖条数已达上限 ${MAX_OVERRIDES_PER_TENANT}`)
    }

    await setTenantI18n(id, String(b.locale), keyPath, b.value)
    await invalidateTenantI18nCache(ctx.state.env, id)
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'tenant.i18n', id,
      { locale: b.locale, keyPath, action: isNew ? 'add' : 'update' })
    ok(ctx, { locale: b.locale, keyPath })
  })

  router.delete('/tenants/:id/i18n', platformAuthMiddleware('platform_super'), async (ctx) => {
    const id = Number(ctx.params.id)
    if (!(await tenantById(id))) return fail(ctx, 404, '租户不存在')
    const locale = String(ctx.query.locale ?? '')
    const keyPath = String(ctx.query.keyPath ?? '')
    if (!isSupportedLocale(locale) || !keyPath) return fail(ctx, 400, '参数无效')
    await deleteTenantI18n(id, locale, keyPath)
    await invalidateTenantI18nCache(ctx.state.env, id)
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'tenant.i18n', id,
      { locale, keyPath, action: 'delete' })
    ok(ctx, { locale, keyPath })
  })

  // ── 品牌包（P1-10）──
  router.get('/tenants/:id/brand', platformAuthMiddleware(), async (ctx) => {
    const id = Number(ctx.params.id)
    const tenant = await tenantById(id)
    if (!tenant) return fail(ctx, 404, '租户不存在')
    const raw = await getTenantBrandRaw(id)
    ok(ctx, {
      themeKeys: THEME_KEYS,
      // 未配过品牌时给默认值而不是 null：后台表单要有东西可编辑，
      // 且让人一眼看出"没配就是长这样"
      brand: raw ?? {
        siteName: DEFAULT_BRAND.siteName,
        shortName: DEFAULT_BRAND.shortName,
        logoTextPrimary: DEFAULT_BRAND.logoTextPrimary,
        logoTextAccent: DEFAULT_BRAND.logoTextAccent,
        tagline: DEFAULT_BRAND.tagline,
        logoLightKey: null, logoDarkKey: null, faviconKey: null, appIconKey: null,
        theme: {}, updatedAt: null,
      },
      // 预览用：走平台自己的读取端点，不能直接用租户站的相对路径
      // （平台控制台跑在平台域名下，那条路径会被解析成平台所属租户的资产）
      assetPreviewBase: `/api/v1/platform/tenants/${id}/brand/asset/`,
    })
  })

  router.put('/tenants/:id/brand', platformAuthMiddleware('platform_super'), async (ctx) => {
    const id = Number(ctx.params.id)
    const tenant = await tenantById(id)
    if (!tenant) return fail(ctx, 404, '租户不存在')

    const b = ctx.request.body as Record<string, unknown>
    const patch: BrandUpdate = {}
    const texts: Array<[keyof BrandUpdate, number]> = [
      ['siteName', 64], ['shortName', 32], ['logoTextPrimary', 16], ['logoTextAccent', 16], ['tagline', 64],
    ]
    for (const [field, max] of texts) {
      if (!(field in b)) continue
      const value = String(b[field] ?? '').trim()
      if (value.length > max) return fail(ctx, 400, `${field} 超过 ${max} 字`)
      patch[field] = value as never
    }
    for (const field of ['logoLightKey', 'logoDarkKey', 'faviconKey', 'appIconKey'] as const) {
      if (!(field in b)) continue
      const value = b[field]
      if (value !== null && typeof value !== 'string') return fail(ctx, 400, `${field} 需为字符串或 null`)
      // 只接受本平台生成的 key：否则可以填任意路径把别处的文件读出来
      if (typeof value === 'string' && !/^brand\/[A-Za-z0-9._/-]+$/.test(value)) return fail(ctx, 400, `${field} 非法`)
      patch[field] = value as never
    }
    if ('theme' in b) {
      const raw = b.theme
      if (raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) return fail(ctx, 400, 'theme 需为对象')
      const theme: Record<string, string> = {}
      for (const [k, v] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
        if (!(THEME_KEYS as readonly string[]).includes(k)) return fail(ctx, 400, `未知主题变量 ${k}`)
        if (v === null || v === '') continue
        if (typeof v !== 'string') return fail(ctx, 400, `${k} 需为字符串`)
        const err = validateThemeValue(k as ThemeKey, v)
        if (err) return fail(ctx, 400, `${k}：${err}`)
        theme[k] = v
      }
      patch.theme = theme
    }
    if (Object.keys(patch).length === 0) return fail(ctx, 400, '没有要更新的字段')

    await saveTenantBrand(id, patch)
    await invalidateTenantBrandCache(ctx.state.env, id)
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'tenant.brand', id, { fields: Object.keys(patch) })
    ok(ctx, await getTenantBrandRaw(id))
  })

  // 上传必须在租户上下文里做：存储层按 currentTenant() 加 `t{id}/` 前缀，
  // 不包上下文会把客户的 logo 存进自营站目录。
  router.post('/tenants/:id/brand/asset', platformAuthMiddleware('platform_super'), async (ctx) => {
    const id = Number(ctx.params.id)
    const tenant = await tenantById(id)
    if (!tenant) return fail(ctx, 404, '租户不存在')

    const b = ctx.request.body as { slot?: unknown; imageData?: unknown }
    const slot = String(b.slot ?? '')
    if (!['logoLight', 'logoDark', 'favicon', 'appIcon'].includes(slot)) return fail(ctx, 400, '非法 slot')
    if (typeof b.imageData !== 'string') return fail(ctx, 400, 'imageData 必填')
    const parsed = parseImageDataUrl(b.imageData)
    if (!parsed) return fail(ctx, 400, '只支持 PNG、JPG、WEBP 图片')
    if (parsed.data.length > 2 * 1024 * 1024) return fail(ctx, 400, '图片不能超过 2MB')

    const key = `brand/${slot}/${Date.now()}-${randomUUID()}.${parsed.ext}`
    await runWithTenant(tenant, () => getStorageProvider(ctx.state.env).put(key, parsed.data, parsed.mimeType))
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'tenant.brand.asset', id, { slot, key })
    ok(ctx, { key })
  })

  // 预览：平台控制台不在租户域名下，读不到租户作用域的文件，故由平台代读
  router.get('/tenants/:id/brand/asset/(.*)', platformAuthMiddleware(), async (ctx) => {
    const id = Number(ctx.params.id)
    const key = decodeURIComponent(ctx.params[0] ?? '')
    if (!/^brand\/[A-Za-z0-9._/-]+$/.test(key) || key.includes('..')) return fail(ctx, 400, '非法 key')
    const tenant = await tenantById(id)
    if (!tenant) return fail(ctx, 404, '租户不存在')

    const file = await runWithTenant(tenant, () => getStorageProvider(ctx.state.env).get(key))
    if (!file) return fail(ctx, 404, '文件不存在', 404)
    ctx.set('Content-Type', file.mimeType)
    ctx.set('Cache-Control', 'private, max-age=60')
    ctx.body = file.data
  })

  // ── 功能开关（P1-8）──
  // 返回三份：生效值 / 套餐默认 / 租户覆盖。
  // 只给生效值的话，后台看不出「这个 off 是套餐带的还是这家单独关的」，
  // 也就无从判断清掉覆盖会回到什么。
  // ── 外部对接：聚合商子代理 / 支付通道（P1-5 收尾）────────────────────────
  // 在 568win 开子代理、在支付商开商户号都是线下签约动作，没有开户 API，"自动注册"
  // 做不到也不该做。能自动化的是登记之后的一切：平台后台录一次 → 下发到租户库 →
  // 开站自动带上，人肉改配置那一步没有了。

  router.put('/tenants/:id/provider', platformAuthMiddleware('platform_super'), async (ctx) => {
    const id = Number(ctx.params.id)
    const tenant = await tenantById(id)
    if (!tenant) return fail(ctx, 404, '租户不存在')
    const b = ctx.request.body as Record<string, unknown>
    const provider = String(b.provider ?? 'win568').trim()
    if (provider !== 'win568') return fail(ctx, 400, '当前只支持 win568')
    const agentAccount = String(b.agentAccount ?? '').trim()
    if (!agentAccount) return fail(ctx, 400, '子代理账号不能为空')
    const status = String(b.status ?? 'pending')
    if (!['pending', 'active', 'disabled'].includes(status)) return fail(ctx, 400, 'status 不合法')
    try {
      await saveTenantProvider(id, {
        provider,
        agentAccount,
        companyKey: String(b.companyKey ?? '').trim(),
        serverId: String(b.serverId ?? '').trim(),
        status: status as 'pending' | 'active' | 'disabled',
        remark: String(b.remark ?? '').trim(),
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : '保存失败'
      const code = (e as { code?: string }).code
      if (code === 'ER_DUP_ENTRY') return fail(ctx, 400, `子代理账号 ${agentAccount} 已分配给其他租户`)
      return fail(ctx, 400, msg)
    }
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'tenant.provider', id, { provider, agentAccount })
    ok(ctx, { providers: await listTenantProviders(id) })
  })

  // 下发：写进租户库的 bg_admin_settings，之后该租户的 win568 调用自动用自己的子代理
  router.post('/tenants/:id/provider/:provider/sync', platformAuthMiddleware('platform_super'), async (ctx) => {
    const id = Number(ctx.params.id)
    const tenant = await tenantById(id)
    if (!tenant) return fail(ctx, 404, '租户不存在')
    try {
      // 必须在租户上下文里写：不包上下文会把客户的子代理密钥写进自营站的设置表
      const res = await runWithTenant(tenant, () => syncProviderToTenantDb(ctx.state.env, id, String(ctx.params.provider)))
      await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'tenant.provider.sync', id,
        { provider: ctx.params.provider })
      ok(ctx, { ...res, providers: await listTenantProviders(id) })
    } catch (e) {
      fail(ctx, 400, e instanceof Error ? e.message : '下发失败')
    }
  })

  router.put('/tenants/:id/channels/:code', platformAuthMiddleware('platform_super'), async (ctx) => {
    const id = Number(ctx.params.id)
    const tenant = await tenantById(id)
    if (!tenant) return fail(ctx, 404, '租户不存在')
    const code = String(ctx.params.code).trim().toLowerCase()
    if (!/^[a-z0-9_-]{2,32}$/.test(code)) return fail(ctx, 400, '通道代号不合法')
    const b = ctx.request.body as Record<string, unknown>
    const owner = String(b.owner ?? 'platform')
    if (owner !== 'platform' && owner !== 'tenant') return fail(ctx, 400, 'owner 只能是 platform 或 tenant')
    try {
      await saveTenantChannel(id, {
        channelCode: code,
        owner,
        merchantNo: String(b.merchantNo ?? '').trim(),
        credential: String(b.credential ?? '').trim(),
        enabled: b.enabled !== false,
        sortOrder: Number(b.sortOrder ?? 100),
      })
    } catch (e) {
      return fail(ctx, 400, e instanceof Error ? e.message : '保存失败')
    }
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'tenant.channel', id, { channel: code, owner })
    ok(ctx, { channels: await listTenantChannels(id) })
  })

  router.delete('/tenants/:id/channels/:code', platformAuthMiddleware('platform_super'), async (ctx) => {
    const id = Number(ctx.params.id)
    const tenant = await tenantById(id)
    if (!tenant) return fail(ctx, 404, '租户不存在')
    await deleteTenantChannel(id, String(ctx.params.code))
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'tenant.channel.delete', id,
      { channel: ctx.params.code })
    ok(ctx, { channels: await listTenantChannels(id) })
  })

  // 下发通道分配：未分配的一律关掉 —— 新站的 payment_channels 是从自营库整表复制来的，
  // 不关掉就等于开站即挂着一批平台没分给它的收款方式
  router.post('/tenants/:id/channels/sync', platformAuthMiddleware('platform_super'), async (ctx) => {
    const id = Number(ctx.params.id)
    const tenant = await tenantById(id)
    if (!tenant) return fail(ctx, 404, '租户不存在')
    try {
      const res = await runWithTenant(tenant, () => syncChannelsToTenantDb(ctx.state.env, id))
      await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'tenant.channel.sync', id, res)
      ok(ctx, res)
    } catch (e) {
      fail(ctx, 400, e instanceof Error ? e.message : '下发失败')
    }
  })

  // ── App 出包参数（P1-15）──────────────────────────────────────────────────
  // 出包本身在出包机上跑（scripts/build-tenant-apk.sh），这里只维护参数：
  // 平台库存不下签名密钥，服务器也没有 Android SDK，把构建塞进服务端只会得到一个跑不动的按钮。

  router.get('/tenants/:id/app', platformAuthMiddleware(), async (ctx) => {
    const id = Number(ctx.params.id)
    const tenant = await tenantById(id)
    if (!tenant) return fail(ctx, 404, '租户不存在')
    const pool = getPlatformPool()
    const [markets] = await pool.query<RowDataPacket[]>(
      'SELECT market FROM pf_tenant_market WHERE tenant_id = ? ORDER BY market', [id])
    const [domains] = await pool.query<RowDataPacket[]>(
      `SELECT domain, app_priority FROM pf_tenant_domain
        WHERE tenant_id = ? AND purpose = 'site' AND enabled = 1
        ORDER BY app_priority, domain`, [id])
    ok(ctx, {
      items: await listTenantApps(id),
      markets: markets.map((m) => String(m.market)),
      // 线路组只能从已登记的站点域名里挑：打进 APK 的域名写错了要重新发包才能救
      domainCandidates: domains.map((d) => String(d.domain)),
      buildCommand: `bash scripts/build-tenant-apk.sh ${tenant.code} --market <市场> --icon <图标.png>`,
    })
  })

  router.put('/tenants/:id/app', platformAuthMiddleware('platform_super'), async (ctx) => {
    const id = Number(ctx.params.id)
    const tenant = await tenantById(id)
    if (!tenant) return fail(ctx, 404, '租户不存在')

    const b = ctx.request.body as Record<string, unknown>
    const input: TenantAppBuild = {
      appMarket: String(b.appMarket ?? '').trim().toUpperCase(),
      packageName: String(b.packageName ?? '').trim().toLowerCase(),
      appLabel: String(b.appLabel ?? '').trim(),
      routeDomains: (Array.isArray(b.routeDomains) ? b.routeDomains : [])
        .map((d) => String(d).trim().toLowerCase()).filter(Boolean),
      tgRecoveryChannel: String(b.tgRecoveryChannel ?? '').trim(),
      splashBackground: String(b.splashBackground ?? '#080b14').trim(),
      keystoreRef: String(b.keystoreRef ?? '').trim(),
      versionCode: Number(b.versionCode ?? 1),
      versionName: String(b.versionName ?? '1.0.0').trim(),
      updatedAt: null,
    }
    const err = validateTenantApp(input)
    if (err) return fail(ctx, 400, err)

    const pool = getPlatformPool()
    const [markets] = await pool.query<RowDataPacket[]>(
      'SELECT market FROM pf_tenant_market WHERE tenant_id = ? AND market = ?', [id, input.appMarket])
    if (!markets.length) return fail(ctx, 400, `该租户没有开通市场 ${input.appMarket}`)

    // 线路域名必须是已登记且启用的站点域名。写错的域名一旦打进 APK，
    // 只能靠重新发包补救 —— 这条校验值得挡在这里
    const [owned] = await pool.query<RowDataPacket[]>(
      `SELECT domain FROM pf_tenant_domain WHERE tenant_id = ? AND purpose = 'site' AND enabled = 1`, [id])
    const ownedSet = new Set(owned.map((d) => String(d.domain)))
    const unknown = input.routeDomains.filter((d) => !ownedSet.has(d))
    if (unknown.length) return fail(ctx, 400, `线路域名未登记或未启用：${unknown.join(', ')}`)

    try {
      await saveTenantApp(id, input)
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'ER_DUP_ENTRY') return fail(ctx, 400, `包名 ${input.packageName} 已被其他租户占用`)
      throw e
    }
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'tenant.app', id, {
      market: input.appMarket, packageName: input.packageName,
    })
    ok(ctx, { items: await listTenantApps(id) })
  })

  router.delete('/tenants/:id/app/:market', platformAuthMiddleware('platform_super'), async (ctx) => {
    const id = Number(ctx.params.id)
    const tenant = await tenantById(id)
    if (!tenant) return fail(ctx, 404, '租户不存在')
    const market = String(ctx.params.market).toUpperCase()
    await deleteTenantApp(id, market)
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'tenant.app.delete', id, { market })
    ok(ctx, { items: await listTenantApps(id) })
  })

  router.get('/tenants/:id/features', platformAuthMiddleware(), async (ctx) => {
    const id = Number(ctx.params.id)
    const [[row]] = await getPlatformPool().query<RowDataPacket[]>(
      'SELECT id FROM pf_tenant WHERE id = ? LIMIT 1', [id]) as unknown as [RowDataPacket[]]
    if (!row) return fail(ctx, 404, '租户不存在')
    const [effective, planDefaults, overrides] = await Promise.all([
      getTenantFeatures(ctx.state.env, id),
      getPlanDefaults(id),
      listTenantOverrides(id),
    ])
    ok(ctx, { keys: FEATURE_KEYS, effective, planDefaults, overrides })
  })

  // enabled = true/false 写覆盖；null 删除覆盖回落套餐默认值。
  // 没有 null 这个语义就只能靠「写一个和套餐相同的值」假装恢复，换套餐后会留下钉死的错值。
  router.put('/tenants/:id/features/:key', platformAuthMiddleware('platform_super'), async (ctx) => {
    const id = Number(ctx.params.id)
    const key = String(ctx.params.key)
    if (!isFeatureKey(key)) return fail(ctx, 400, '未知的功能开关')
    const raw = (ctx.request.body as { enabled?: unknown }).enabled
    if (raw !== true && raw !== false && raw !== null) return fail(ctx, 400, 'enabled 需为 true / false / null')

    const [[row]] = await getPlatformPool().query<RowDataPacket[]>(
      'SELECT id FROM pf_tenant WHERE id = ? LIMIT 1', [id]) as unknown as [RowDataPacket[]]
    if (!row) return fail(ctx, 404, '租户不存在')

    const before = (await listTenantOverrides(id))[key]
    await setTenantOverride(id, key, raw)
    // 开关缓存 300s，不清的话后台改完最长 5 分钟内前台仍是旧值，看起来像没生效
    await invalidateTenantFeatureCache(ctx.state.env, id)
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip, 'tenant.feature', id, {
      key, from: before === undefined ? null : before, to: raw,
    })
    ok(ctx, { id, key, effective: await getTenantFeatures(ctx.state.env, id) })
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
  // 自动签发开关（P1-4）。签发本身在宿主机跑（deploy/single-node/issue-tenant-certs.sh
  // + betogo-cert.timer）：容器碰不到 nginx 与 certbot，这里放个按钮只会是个永远失败的按钮。
  // 关掉它用于「证书托管在 Cloudflare 等外部」的域名 —— 平台不要去动人家的证书。
  router.put('/tenants/:id/domains/:domainId/acme', platformAuthMiddleware('platform_super'), async (ctx) => {
    const id = Number(ctx.params.id)
    const domainId = Number(ctx.params.domainId)
    const enabled = (ctx.request.body as { enabled?: unknown }).enabled === true
    const pool = getPlatformPool()
    const [[row]] = await pool.query<RowDataPacket[]>(
      'SELECT domain, domain_type FROM pf_tenant_domain WHERE id = ? AND tenant_id = ? LIMIT 1',
      [domainId, id]) as unknown as [RowDataPacket[]]
    if (!row) return fail(ctx, 404, '域名不存在')
    // 平台子域名走泛域名证书，没有单独签发这回事，开关对它没有意义
    if (row.domain_type === 'platform_subdomain') return fail(ctx, 400, '平台子域名由泛域名证书覆盖，无需单独签发')
    await pool.execute('UPDATE pf_tenant_domain SET acme_enabled = ? WHERE id = ?', [enabled ? 1 : 0, domainId])
    await writeAudit(ctx.state.platformAdmin?.adminId ?? null, ctx.ip,
      enabled ? 'domain.acme.on' : 'domain.acme.off', id, { domain: row.domain })
    ok(ctx, { ok: true, enabled })
  })

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
