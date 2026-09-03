/**
 * 跨租户隔离验收套件（方案文档第 9 节清单）。
 * 这里覆盖「隔离机制」层面；需要真实双库的端到端验证见 scripts/tenant-isolation-e2e.sh。
 *
 * 这套用例的意义：租户隔离一旦破了，表现是「别家的钱进了自己账」，
 * 而且不会报错。所以必须有断言把每一条隔离链路钉死。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../config/env.js'

const createdPools: Array<{ database: string }> = []
vi.mock('mysql2/promise', () => ({
  default: {
    createPool: (opts: { database: string }) => {
      createdPools.push({ database: opts.database })
      return { end: async () => {}, __db: opts.database }
    },
  },
}))

const createdRedis: Array<{ keyPrefix: string }> = []
vi.mock('ioredis', () => ({
  Redis: class {
    options: { keyPrefix?: string }
    constructor(_url: string, opts?: { keyPrefix?: string }) {
      this.options = { keyPrefix: opts?.keyPrefix }
      createdRedis.push({ keyPrefix: opts?.keyPrefix ?? '' })
    }
    on() { return this }
    async quit() { return 'OK' }
  },
}))

const { getMysqlPool, __resetMysqlPoolsForTest } = await import('../clients/mysql.client.js')
const { getRedis, getDefaultRedis, keyPrefixFor } = await import('../clients/redis.client.js')
const { runWithTenant, currentTenantOrNull } = await import('../lib/tenant-context.js')

const env = { REDIS_URL: 'redis://x', KYC_STORAGE_DIR: '/data', S3_BUCKET: '' } as unknown as Env
const t1 = { id: 1, code: 'betogo', database: 'betogo', status: 'active' as const, selfOperated: true }
const t2 = { id: 2, code: 't002', database: 'betogo_t002', status: 'active' as const, selfOperated: false }
const t3 = { id: 3, code: 't003', database: 'betogo_t003', status: 'active' as const, selfOperated: false }

beforeEach(() => {
  createdPools.length = 0
  createdRedis.length = 0
  __resetMysqlPoolsForTest()
  process.env.MYSQL_HOST = 'db'
  process.env.MYSQL_PASSWORD = 'pw'
  process.env.MYSQL_DATABASE = 'betogo'
  delete process.env.TENANT_RESOLVE_STRICT
})

describe('跨租户隔离验收', () => {
  // 清单 1：数据访问必须落在各自的库，不存在「查到别家数据」的路径
  it('不同租户的同一段业务代码落到不同的库', () => {
    const a = runWithTenant(t1, () => getMysqlPool(env)) as unknown as { __db: string }
    const b = runWithTenant(t2, () => getMysqlPool(env)) as unknown as { __db: string }
    const c = runWithTenant(t3, () => getMysqlPool(env)) as unknown as { __db: string }
    expect([a.__db, b.__db, c.__db]).toEqual(['betogo', 'betogo_t002', 'betogo_t003'])
    expect(new Set([a, b, c]).size).toBe(3)
  })

  // 清单 2：两租户存在相同 userId 时，余额/会话/幂等键必须互不影响。
  // 机制是 keyPrefix —— 同一个键名在不同租户下落到不同的实际键。
  it('相同键名在不同租户下前缀不同', () => {
    const r1 = runWithTenant(t1, () => getRedis(env))
    const r2 = runWithTenant(t2, () => getRedis(env))
    const r3 = runWithTenant(t3, () => getRedis(env))
    expect(r1.options.keyPrefix ?? '').toBe('')
    expect(r2.options.keyPrefix).toBe('t2:')
    expect(r3.options.keyPrefix).toBe('t3:')
    // 三个租户三个独立客户端，不能共用一个连接把前缀串了
    expect(new Set([r1, r2, r3]).size).toBe(3)
  })

  it('自营站保持无前缀，存量键名不受影响', () => {
    expect(keyPrefixFor(t1)).toBe('')
    expect(keyPrefixFor(t2)).toBe('t2:')
    // 无上下文（启动期/平台级任务）也按无前缀处理，与自营站一致
    expect(keyPrefixFor(null)).toBe('')
  })

  it('平台库缓存走无前缀客户端，不被任何租户前缀污染', () => {
    const platform = getDefaultRedis(env)
    const tenantClient = runWithTenant(t2, () => getRedis(env))
    expect(platform.options.keyPrefix ?? '').toBe('')
    expect(tenantClient.options.keyPrefix).toBe('t2:')
    expect(platform).not.toBe(tenantClient)
  })

  // 清单 1 附带：上传的凭证/图片不能跨租户读到 —— 存储路径隔离由
  // tenant-storage.test.ts 专门覆盖（含 put 返回值不带前缀这一关键点），此处不重复

  // 严格模式是上线包网客户前的闸门：没有租户上下文时必须炸，不能落到自营库
  it('严格模式下无租户上下文一律拒绝，不回落自营库', () => {
    process.env.TENANT_RESOLVE_STRICT = 'true'
    expect(currentTenantOrNull()).toBeNull()
    expect(() => getMysqlPool(env)).toThrow(/没有租户上下文/)
    expect(createdPools).toHaveLength(0)
  })

  // 并发是最容易串号的场景：两个租户的请求交错执行时上下文不能互相污染
  it('并发交错执行时租户上下文不串号', async () => {
    const seen: Array<{ code: string; db: string; prefix: string }> = []
    await Promise.all([t1, t2, t3].map((tenant, i) =>
      runWithTenant(tenant, async () => {
        await new Promise((r) => setTimeout(r, (3 - i) * 5))
        seen.push({
          code: currentTenantOrNull()!.code,
          db: (getMysqlPool(env) as unknown as { __db: string }).__db,
          prefix: getRedis(env).options.keyPrefix ?? '',
        })
      }),
    ))
    expect(seen.sort((a, b) => a.code.localeCompare(b.code))).toEqual([
      { code: 'betogo', db: 'betogo', prefix: '' },
      { code: 't002', db: 'betogo_t002', prefix: 't2:' },
      { code: 't003', db: 'betogo_t003', prefix: 't3:' },
    ])
  })
})
