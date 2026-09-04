import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import { runWithTenant, type TenantContext } from '../lib/tenant-context.js'

const query = vi.fn()
vi.mock('../clients/platform-mysql.client.js', () => ({
  getPlatformPool: () => ({ query }),
  platformDatabase: () => 'betogo_platform',
}))

function fakeRedis() {
  const store = new Map<string, string>()
  return {
    options: { keyPrefix: undefined },
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { store.set(k, v); return 'OK' }),
    del: vi.fn(async (...ks: string[]) => { ks.forEach((k) => store.delete(k)); return ks.length }),
    keys: vi.fn(async (p: string) => [...store.keys()].filter((k) => k.startsWith(p.replace(/\*$/, '')))),
  } as unknown as Redis & { store: Map<string, string> }
}

let redis = fakeRedis()
vi.mock('../clients/redis.client.js', async () => {
  const actual = await vi.importActual<typeof import('../clients/redis.client.js')>('../clients/redis.client.js')
  return { ...actual, getDefaultRedis: () => redis }
})

const { checkPlanLimits, isLimitKey } = await import('../services/plan-limit.service.js')

const env = {} as Env
const tenant: TenantContext = {
  id: 9, code: 'demo1', database: 'betogo_demo1', status: 'trial', selfOperated: false,
}

beforeEach(() => { query.mockReset(); redis = fakeRedis() })

describe('套餐可覆盖范围', () => {
  it('超上限被拒，错误信息带上区间', async () => {
    query.mockResolvedValueOnce([[{ config_key: 'rebate_rate_pct', min_value: '0', max_value: '1.5' }]])
    const err = await runWithTenant(tenant, () =>
      checkPlanLimits(env, [{ key: 'rebate_rate_pct', value: 3, label: 'L1/slots' }]))
    expect(err).toContain('不得高于 1.5')
    expect(err).toContain('L1/slots')
  })

  it('低于下限被拒', async () => {
    query.mockResolvedValueOnce([[{ config_key: 'withdraw_min', min_value: '50', max_value: null }]])
    const err = await runWithTenant(tenant, () => checkPlanLimits(env, [{ key: 'withdraw_min', value: 10 }]))
    expect(err).toContain('不得低于 50')
  })

  it('区间内放行', async () => {
    query.mockResolvedValueOnce([[{ config_key: 'rebate_rate_pct', min_value: '0', max_value: '5' }]])
    const err = await runWithTenant(tenant, () => checkPlanLimits(env, [{ key: 'rebate_rate_pct', value: 2 }]))
    expect(err).toBeNull()
  })

  it('未登记的 key 一律放行（白名单语义）', async () => {
    query.mockResolvedValueOnce([[]])
    const err = await runWithTenant(tenant, () => checkPlanLimits(env, [{ key: 'bonus_wager_mult', value: 999 }]))
    expect(err).toBeNull()
  })

  it('无租户上下文时不校验，也不查库', async () => {
    expect(await checkPlanLimits(env, [{ key: 'withdraw_min', value: -1 }])).toBeNull()
    expect(query).not.toHaveBeenCalled()
  })

  it('平台库故障时不做校验，不把后台配置页锁死', async () => {
    query.mockRejectedValueOnce(new Error('boom'))
    const err = await runWithTenant(tenant, () => checkPlanLimits(env, [{ key: 'rebate_rate_pct', value: 999 }]))
    expect(err).toBeNull()
    expect(redis.store.size).toBe(0)
  })

  it('缓存命中后不再查库', async () => {
    query.mockResolvedValueOnce([[{ config_key: 'rebate_rate_pct', min_value: '0', max_value: '1' }]])
    await runWithTenant(tenant, () => checkPlanLimits(env, [{ key: 'rebate_rate_pct', value: 0.5 }]))
    await runWithTenant(tenant, () => checkPlanLimits(env, [{ key: 'rebate_rate_pct', value: 0.5 }]))
    expect(query).toHaveBeenCalledTimes(1)
    expect([...redis.store.keys()]).toEqual(['platform:plan-limits:9'])
  })

  it('isLimitKey 拒绝未知配置项', () => {
    expect(isLimitKey('withdraw_min')).toBe(true)
    expect(isLimitKey('drop_table')).toBe(false)
  })
})
