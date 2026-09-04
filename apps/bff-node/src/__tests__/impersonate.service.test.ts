import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'

function fakeRedis() {
  const store = new Map<string, string>()
  return {
    options: { keyPrefix: undefined },
    store,
    setex: vi.fn(async (k: string, _ttl: number, v: string) => { store.set(k, v); return 'OK' }),
    // GETDEL 的语义：取出并原子删除
    getdel: vi.fn(async (k: string) => {
      const v = store.get(k) ?? null
      store.delete(k)
      return v
    }),
  } as unknown as Redis & { store: Map<string, string> }
}

let redis = fakeRedis()
vi.mock('../clients/redis.client.js', async () => {
  const actual = await vi.importActual<typeof import('../clients/redis.client.js')>('../clients/redis.client.js')
  return { ...actual, getDefaultRedis: () => redis }
})

const { consumeImpersonateTicket, issueImpersonateTicket } = await import('../services/impersonate.service.js')
const env = {} as Env

beforeEach(() => { redis = fakeRedis() })

describe('impersonate 票据', () => {
  it('签发后可兑换，票据键无租户前缀', async () => {
    const { ticket } = await issueImpersonateTicket(env, {
      tenantId: 9, platformAdminId: 1, platformUsername: 'admin',
    })
    expect([...redis.store.keys()][0]).toBe(`platform:impersonate:${ticket}`)
    const payload = await consumeImpersonateTicket(env, ticket)
    expect(payload?.tenantId).toBe(9)
    expect(payload?.platformUsername).toBe('admin')
  })

  it('只能用一次 —— 第二次兑换必须为空', async () => {
    const { ticket } = await issueImpersonateTicket(env, {
      tenantId: 9, platformAdminId: 1, platformUsername: 'admin',
    })
    expect(await consumeImpersonateTicket(env, ticket)).not.toBeNull()
    expect(await consumeImpersonateTicket(env, ticket)).toBeNull()
  })

  it('格式非法的票据不查 Redis，直接拒', async () => {
    expect(await consumeImpersonateTicket(env, 'short')).toBeNull()
    expect(await consumeImpersonateTicket(env, '../../etc/passwd')).toBeNull()
    expect(redis.getdel).not.toHaveBeenCalled()
  })

  it('TTL 是 60 秒，不给长期可转发的凭据', async () => {
    await issueImpersonateTicket(env, { tenantId: 9, platformAdminId: 1, platformUsername: 'a' })
    expect(redis.setex).toHaveBeenCalledWith(expect.any(String), 60, expect.any(String))
  })
})
