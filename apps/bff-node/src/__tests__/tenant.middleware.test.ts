import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Context } from 'koa'
import type { Redis } from 'ioredis'

const resolveTenantByHost = vi.fn()
const selfOperatedTenant = vi.fn()
vi.mock('../services/tenant.service.js', () => ({ resolveTenantByHost, selfOperatedTenant }))

const { tenantMiddleware } = await import('../middleware/tenant.js')
const { currentTenantOrNull } = await import('../lib/tenant-context.js')

const redisStub = {} as Redis

const self = { id: 1, code: 'betogo', database: 'betogo', status: 'active' as const, selfOperated: true }

function fakeCtx(path: string, host = 'betogo.games'): Context {
  return {
    path,
    host,
    get: (name: string) => (name === 'X-Forwarded-Host' ? '' : ''),
    state: { redis: {} },
    status: 200,
    body: undefined,
  } as unknown as Context
}

beforeEach(() => {
  resolveTenantByHost.mockReset()
  selfOperatedTenant.mockReset()
  // 自营站兜底在中间件内有 60s 内存缓存，用不同返回值会被缓存掩盖，这里固定同一值
  selfOperatedTenant.mockResolvedValue(self)
})

describe('租户中间件', () => {
  it('命中租户后写入上下文，下游可读到', async () => {
    resolveTenantByHost.mockResolvedValue(self)
    const ctx = fakeCtx('/api/v1/site/config')
    let seen: string | undefined
    await tenantMiddleware(redisStub, false)(ctx, async () => { seen = currentTenantOrNull()?.database })
    expect(seen).toBe('betogo')
    expect(ctx.state.tenant).toEqual(self)
  })

  // 探针以 IP 直连，永远匹配不到域名；strict 下不放行会把容器打成不健康反复重启
  it('健康检查不做租户解析，直接放行', async () => {
    const ctx = fakeCtx('/health', '127.0.0.1:3000')
    let called = false
    await tenantMiddleware(redisStub, true)(ctx, async () => { called = true })
    expect(called).toBe(true)
    expect(resolveTenantByHost).not.toHaveBeenCalled()
  })

  it('观察模式下未登记域名回落自营站', async () => {
    resolveTenantByHost.mockResolvedValue(null)
    const ctx = fakeCtx('/api/v1/site/config', 'unknown.example')
    let seen: string | undefined
    await tenantMiddleware(redisStub, false)(ctx, async () => { seen = currentTenantOrNull()?.code })
    expect(seen).toBe('betogo')
  })

  it('严格模式下未登记域名 404，且不执行下游', async () => {
    resolveTenantByHost.mockResolvedValue(null)
    const ctx = fakeCtx('/api/v1/site/config', 'unknown.example')
    let called = false
    await tenantMiddleware(redisStub, true)(ctx, async () => { called = true })
    expect(ctx.status).toBe(404)
    expect(called).toBe(false)
    expect(selfOperatedTenant).not.toHaveBeenCalled()
  })
})
