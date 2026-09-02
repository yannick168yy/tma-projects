import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../config/env.js'

const created: Array<{ database: string; connectionLimit: number }> = []
vi.mock('mysql2/promise', () => ({
  default: {
    createPool: (opts: { database: string; connectionLimit: number }) => {
      created.push({ database: opts.database, connectionLimit: opts.connectionLimit })
      return { end: async () => {}, __db: opts.database }
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

  // 自营站的池 10 是压测验证过的吞吐上限，不能被多租户改造顺手缩掉
  it('自营站保持大池，其他租户用小池', () => {
    runWithTenant(self, () => getMysqlPool(env))
    runWithTenant(t2, () => getMysqlPool(env))
    expect(created).toEqual([
      { database: 'betogo', connectionLimit: 10 },
      { database: 'betogo_t002', connectionLimit: 2 },
    ])
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
