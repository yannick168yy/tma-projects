import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../config/env.js'

const created: Array<{ database: string; connectionLimit: number; maxIdle: number; queueLimit: number }> = []
vi.mock('mysql2/promise', () => ({
  default: {
    createPool: (opts: { database: string; connectionLimit: number; maxIdle: number; queueLimit: number }) => {
      created.push({
        database: opts.database,
        connectionLimit: opts.connectionLimit,
        maxIdle: opts.maxIdle,
        queueLimit: opts.queueLimit,
      })
      return { end: async () => {}, getConnection: async () => ({ release() {} }), __db: opts.database }
    },
  },
}))

const { getMysqlPool, defaultDatabase, __resetMysqlPoolsForTest } = await import('../clients/mysql.client.js')
const { runWithTenant } = await import('../lib/tenant-context.js')

const env = {} as Env
const self = { id: 1, code: 'betogo', database: 'betogo', status: 'active' as const, selfOperated: true }
const t2 = { id: 2, code: 't002', database: 'betogo_t002', status: 'active' as const, selfOperated: false }
const t3 = { id: 3, code: 't003', database: 'betogo_t003', status: 'trial' as const, selfOperated: false }

beforeEach(() => {
  created.length = 0
  __resetMysqlPoolsForTest()
  process.env.MYSQL_HOST = 'db'
  process.env.MYSQL_PASSWORD = 'pw'
  process.env.MYSQL_DATABASE = 'betogo'
  delete process.env.TENANT_RESOLVE_STRICT
})

describe('连接池按租户路由', () => {
  it('不同租户拿到不同库的池', () => {
    const a = runWithTenant(self, () => getMysqlPool(env)) as unknown as { __db: string }
    const b = runWithTenant(t2, () => getMysqlPool(env)) as unknown as { __db: string }
    expect(a.__db).toBe('betogo')
    expect(b.__db).toBe('betogo_t002')
    expect(created.map((c) => c.database)).toEqual(['betogo', 'betogo_t002'])
  })

  it('同一租户复用同一个池，不重复建连接', () => {
    runWithTenant(t2, () => { getMysqlPool(env); getMysqlPool(env); getMysqlPool(env) })
    expect(created).toHaveLength(1)
  })

  // 池策略改为每租户可配（初始数/最大数/排队上限），断言配置被原样应用
  it('按租户配置建池：初始数落到 maxIdle，最大数落到 connectionLimit', () => {
    runWithTenant({ ...self, pool: { min: 2, max: 10, queueLimit: 0 } }, () => getMysqlPool(env))
    runWithTenant({ ...t2, pool: { min: 1, max: 4, queueLimit: 20 } }, () => getMysqlPool(env))
    expect(created).toEqual([
      { database: 'betogo', connectionLimit: 10, maxIdle: 2, queueLimit: 0 },
      { database: 'betogo_t002', connectionLimit: 4, maxIdle: 1, queueLimit: 20 },
    ])
  })

  // 初始数配得比最大数大时不能把 maxIdle 顶出上限，否则 mysql2 行为未定义
  it('初始数超过最大数时被夹到最大数', () => {
    runWithTenant({ ...t2, pool: { min: 99, max: 3, queueLimit: 0 } }, () => getMysqlPool(env))
    expect(created[0]).toEqual({ database: 'betogo_t002', connectionLimit: 3, maxIdle: 3, queueLimit: 0 })
  })

  // 没有平台库配置时（bootstrap 兜底上下文）回落环境变量，不能建出 0 连接的死池
  it('无池配置时回落环境变量默认值', () => {
    runWithTenant(self, () => getMysqlPool(env))
    expect(created[0].connectionLimit).toBeGreaterThan(0)
    expect(created[0].maxIdle).toBeGreaterThanOrEqual(0)
  })

  it('无上下文时回落自营站库', () => {
    const p = getMysqlPool(env) as unknown as { __db: string }
    expect(p.__db).toBe(defaultDatabase())
  })

  // 回落是 P0 过渡期的临时行为，切严格模式后必须炸而不是打到自营库
  it('严格模式下无上下文直接抛错', () => {
    process.env.TENANT_RESOLVE_STRICT = 'true'
    expect(() => getMysqlPool(env)).toThrow(/没有租户上下文/)
    expect(created).toHaveLength(0)
  })

  it('并发不同租户各走各的库', async () => {
    const dbs = await Promise.all([
      runWithTenant(t2, async () => {
        await new Promise((r) => setTimeout(r, 5))
        return (getMysqlPool(env) as unknown as { __db: string }).__db
      }),
      runWithTenant(t3, async () => {
        await new Promise((r) => setTimeout(r, 1))
        return (getMysqlPool(env) as unknown as { __db: string }).__db
      }),
    ])
    expect(dbs).toEqual(['betogo_t002', 'betogo_t003'])
  })
})
