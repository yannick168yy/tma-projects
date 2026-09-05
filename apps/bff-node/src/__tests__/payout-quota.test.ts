import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Redis } from 'ioredis'
import type { Env } from '../config/env.js'
import { runWithTenant, type TenantContext } from '../lib/tenant-context.js'

const query = vi.fn()
const execute = vi.fn()
vi.mock('../clients/platform-mysql.client.js', () => ({
  getPlatformPool: () => ({
    query,
    execute,
    getConnection: async () => ({
      query, execute,
      beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    }),
  }),
  platformDatabase: () => 'betogo_platform',
}))

const fakeRedis = { get: vi.fn(async () => null), setex: vi.fn(async () => 'OK'), del: vi.fn(async () => 1) } as unknown as Redis
vi.mock('../clients/redis.client.js', async () => {
  const actual = await vi.importActual<typeof import('../clients/redis.client.js')>('../clients/redis.client.js')
  return { ...actual, getDefaultRedis: () => fakeRedis }
})
vi.mock('../clients/mysql.client.js', () => ({ getMysqlPool: () => ({ query }) }))
vi.mock('../services/exchange-rate.service.js', () => ({
  getRate: async () => ({ rate: 0.017, source: 'test' }),
}))

const { assertPayoutQuota, PayoutQuotaError } = await import('../services/billing/payout-quota.service.js')

const env = {} as Env
const order = { orderId: 'W1', channelId: 'unispay_dana', amount: 100000, currency: 'PHP' }

const tenant = (patch: Partial<TenantContext> = {}): TenantContext => ({
  id: 7, code: 'demo1', database: 'betogo_demo1', status: 'active', selfOperated: false, ...patch,
})

/** 通道归属查询 → 额度账户查询，按调用顺序喂数据 */
function mockDb(opts: { owner?: string; deposit?: number; credit?: number; balance?: number }) {
  query.mockReset()
  execute.mockReset()
  execute.mockResolvedValue([{ affectedRows: 1 }])
  query
    .mockResolvedValueOnce([[{
      channel_code: 'unispay_dana', owner: opts.owner ?? 'platform', merchant_no: null,
      fee_rate_pct: 0, fee_fixed: 0, credential_cipher: null, enabled: 1,
    }]])
    .mockResolvedValueOnce([[{
      tenant_id: 7, currency: 'USDT', balance: opts.balance ?? 0,
      deposit_amount: opts.deposit ?? 0, credit_limit: opts.credit ?? 0,
      warn_threshold: null, updated_at: null,
    }]])
}

describe('代付额度门禁（P2-7）', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('自营站直接放行：它的额度账户里没有对应真实资金的余额', async () => {
    mockDb({ deposit: 0, credit: 0 })
    await expect(runWithTenant(tenant({ selfOperated: true }), () =>
      assertPayoutQuota(env, fakeRedis, order))).resolves.toBeUndefined()
  })

  it('未配额度的租户直接放行 —— 宁可漏一家，也不能让配置遗漏卡住所有站的提现', async () => {
    mockDb({ deposit: 0, credit: 0 })
    await expect(runWithTenant(tenant(), () =>
      assertPayoutQuota(env, fakeRedis, order))).resolves.toBeUndefined()
  })

  it('租户自带通道放行：钱从客户自己的通道出，不占平台额度', async () => {
    mockDb({ owner: 'tenant', credit: 10000 })
    await expect(runWithTenant(tenant(), () =>
      assertPayoutQuota(env, fakeRedis, order))).resolves.toBeUndefined()
  })

  it('已配额度且够用：放行', async () => {
    // 10 万 PHP × 0.017 = 1700 USDT，可动用 2000
    mockDb({ credit: 2000, balance: 0 })
    await expect(runWithTenant(tenant(), () =>
      assertPayoutQuota(env, fakeRedis, order))).resolves.toBeUndefined()
  })

  it('已配额度但不够：抛错转人工，不自动拒绝也不平台垫付', async () => {
    mockDb({ credit: 1000, balance: 0 })
    await expect(runWithTenant(tenant(), () => assertPayoutQuota(env, fakeRedis, order)))
      .rejects.toThrow(PayoutQuotaError)
    // 写了人工队列
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('pf_manual_queue'), expect.arrayContaining([7, 'payout_insufficient']))
  })
})
