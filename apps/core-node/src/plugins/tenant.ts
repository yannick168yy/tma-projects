import fp from 'fastify-plugin'
import type { FastifyRequest } from 'fastify'
import { env } from '../config/env.js'
import { runWithTenant, type TenantContext } from '../lib/tenant-context.js'
import { normalizeHost, selfOperatedTenant, tenantByCode, tenantByHost, warmupPlatformPool } from '../clients/platform-mysql.js'

// 平台库彻底不可用时的兜底：指向本服务今天就在用的那个库。
// 只在非严格模式下生效——严格模式（第一个包网客户上线后）宁可 503 也不能猜库。
// 不加这层的话，多租户改造等于给聚合商钱包回调这条资金链路新增了一个单点。
const BOOTSTRAP_TENANT: TenantContext = {
  id: 0, code: 'bootstrap', database: env.MYSQL_DATABASE, status: 'active', selfOperated: true,
}

const HOST_CACHE_PREFIX = 'platform:tenant-by-host:'
const CODE_CACHE_PREFIX = 'platform:tenant-by-code:'
const CACHE_TTL_SECONDS = 300
const MISS_TTL_SECONDS = 30
const MISS = '__miss__'

// 自营站兜底短缓存，避免每个未登记来源都打一次平台库
let selfCache: { value: TenantContext; expiresAt: number } | null = null
const SELF_CACHE_MS = 60_000

const warnedSources = new Set<string>()

/**
 * 回调归属：
 * 1) URL 租户段 `/t/:tenantCode/...` —— 新租户开站时直接下发带租户段的回调地址，
 *    不需要和三方协调改地址；
 * 2) Host —— 走 pf_tenant_domain；
 * 3) 自营站兜底 —— 自营站现有回调地址（无租户段）必须继续可用，
 *    三方那边改 notify URL 要排期，不能因为多租户改造把线上收款打断。
 */
export default fp(async (app) => {
  const redis = app.redis

  // 不阻塞插件注册：预热重试期间 Fastify 不会开始监听，等于服务不可用
  void warmupPlatformPool().catch((err: unknown) => {
    app.log.error({ err }, '平台库预热失败，租户解析会按需重试')
  })

  async function cached<T extends TenantContext>(
    key: string,
    loader: () => Promise<T | null>,
  ): Promise<T | null> {
    const hit = await redis.get(key)
    if (hit === MISS) return null
    if (hit) {
      try { return JSON.parse(hit) as T } catch { /* 缓存脏了就回源 */ }
    }
    let value: T | null
    try {
      value = await loader()
    } catch {
      // 容器重启后 aardvark-dns 有几秒抖动，池现开新连接会 ENOTFOUND。
      // 重试一次能盖住绝大部分，剩下的才当故障处理。
      try {
        await new Promise((r) => setTimeout(r, 300))
        value = await loader()
      } catch (retryErr) {
        // 平台库故障不写缓存，否则恢复后 5 分钟内结论还是错的
        app.log.error({ err: retryErr }, '平台库查询租户失败（含一次重试）')
        return null
      }
    }
    await redis.set(key, value ? JSON.stringify(value) : MISS, 'EX', value ? CACHE_TTL_SECONDS : MISS_TTL_SECONDS)
    return value
  }

  async function getSelfOperated(): Promise<TenantContext | null> {
    if (selfCache && selfCache.expiresAt > Date.now()) return selfCache.value
    let tenant: TenantContext | null = null
    try {
      tenant = await selfOperatedTenant()
    } catch (err) {
      app.log.error({ err }, '平台库不可用，无法读取自营站')
    }
    if (tenant) {
      selfCache = { value: tenant, expiresAt: Date.now() + SELF_CACHE_MS }
      return tenant
    }
    if (process.env.TENANT_RESOLVE_STRICT === 'true') return null
    app.log.error('平台库不可用，回落启动兜底租户（自营站库）')
    return BOOTSTRAP_TENANT
  }

  async function resolve(req: FastifyRequest): Promise<TenantContext | null> {
    const code = (req.params as { tenantCode?: string } | undefined)?.tenantCode
    if (code) {
      const byCode = await cached(`${CODE_CACHE_PREFIX}${code}`, () => tenantByCode(code))
      if (byCode) return byCode
      // 带了租户段却查不到：这是配置错误，不能悄悄回落到自营站收别家的钱
      return null
    }

    const host = normalizeHost(req.headers['x-forwarded-host'] as string || req.headers.host)
    if (host) {
      const byHost = await cached(`${HOST_CACHE_PREFIX}${host}`, () => tenantByHost(host))
      if (byHost) return byHost
    }

    const self = await getSelfOperated()
    if (self) {
      const source = `${req.method} ${req.routeOptions?.url ?? req.url} host=${host}`
      if (!warnedSources.has(source)) {
        if (warnedSources.size > 200) warnedSources.clear()
        warnedSources.add(source)
        app.log.warn({ source }, '回调来源无法归属租户，已回落自营站；接入包网客户前必须改用带租户段的回调地址')
      }
    }
    return self
  }

  app.addHook('onRequest', (req, reply, done) => {
    if (req.url === '/health') {
      done()
      return
    }
    resolve(req)
      .then((tenant) => {
        if (!tenant) {
          // 带了错误租户段，或平台库挂了连自营站都读不到：宁可拒绝也不能打错库
          app.log.error({ url: req.url }, '无法确定租户，拒绝处理')
          reply.status(503).send({ code: 1, message: 'tenant unavailable' })
          return
        }
        runWithTenant(tenant, () => done())
      })
      .catch(done)
  })
}, { name: 'tenant', dependencies: ['mysql'] })
