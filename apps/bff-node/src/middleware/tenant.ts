import type { Middleware } from 'koa'
import type { Redis } from 'ioredis'
import { runWithTenant, type TenantContext } from '../lib/tenant-context.js'
import { resolveTenantByHost, selfOperatedTenant } from '../services/tenant.service.js'
import { childLogger } from '../lib/logger.js'

const log = childLogger('tenant')

// 自营站兜底信息很少变，短缓存即可，避免每个未登记 Host 都打一次平台库
let selfCache: { value: TenantContext; expiresAt: number } | null = null
const SELF_CACHE_MS = 60_000

// 平台库彻底不可用时的兜底：指向本服务今天就在用的那个库。
// 只在非严格模式下生效——严格模式（第一个包网客户上线后）宁可 503 也不能猜库。
// 不加这层的话，多租户改造等于给整站新增了一个单点故障。
function bootstrapTenant(): TenantContext {
  return { id: 0, code: 'bootstrap', database: process.env.MYSQL_DATABASE ?? 'betogo', status: 'active', selfOperated: true }
}

async function getSelfOperated(strict: boolean): Promise<TenantContext | null> {
  if (selfCache && selfCache.expiresAt > Date.now()) return selfCache.value
  let tenant: TenantContext | null = null
  try {
    tenant = await selfOperatedTenant()
  } catch (err) {
    log.error({ err }, '平台库不可用，无法读取自营站')
  }
  if (tenant) {
    selfCache = { value: tenant, expiresAt: Date.now() + SELF_CACHE_MS }
    return tenant
  }
  if (strict) return null
  log.error('平台库不可用，回落启动兜底租户（自营站库）')
  return bootstrapTenant()
}

// 未登记域名只警告一次，否则扫描器能把日志刷爆
const warnedHosts = new Set<string>()
function warnOnce(host: string): void {
  if (warnedHosts.has(host)) return
  if (warnedHosts.size > 500) warnedHosts.clear()
  warnedHosts.add(host)
  log.warn({ host }, '域名未在平台库登记，已回落自营站；上线包网客户前必须补登记并开启 TENANT_RESOLVE_STRICT')
}

/**
 * Host → 租户 → 写入 AsyncLocalStorage。放在 injectDeps 之后、限流之前：
 * 限流与会话的 Redis 键在 P0-6 会带租户前缀，那时必须已经有上下文。
 *
 * strict=false（默认，P0 观察模式）：未登记域名回落自营站并告警。
 *   当前只有自营站一个租户，回落等价于现状，零风险，同时能把真实流量里
 *   所有未登记 Host 收集出来。
 * strict=true：未登记域名直接 404。**第一个包网客户上线前必须切到 true**，
 *   否则别家域名会被打到自营库上。
 */
// 存活探针没有租户语义，且常以 IP 直连（Host 是 127.0.0.1:3000），
// strict 模式下不放行会把健康检查打成 404，容器被判定不健康反复重启
const TENANT_FREE_PATHS = new Set(['/health'])

export function tenantMiddleware(redis: Redis, strict: boolean): Middleware {
  return async (ctx, next) => {
    if (TENANT_FREE_PATHS.has(ctx.path)) {
      await next()
      return
    }
    const host = ctx.get('X-Forwarded-Host') || ctx.host
    let tenant = await resolveTenantByHost(redis, host)

    if (!tenant) {
      if (strict) {
        ctx.status = 404
        ctx.body = { code: 40400, message: 'site not found' }
        return
      }
      warnOnce(host)
      tenant = await getSelfOperated(strict)
    }

    if (!tenant) {
      // 平台库完全不可用且连自营站都读不到：不猜库名，直接拒绝
      log.error({ host }, '无法确定租户，平台库不可用')
      ctx.status = 503
      ctx.body = { code: 50300, message: 'service unavailable' }
      return
    }

    ctx.state.tenant = tenant
    await runWithTenant(tenant, () => next())
  }
}
