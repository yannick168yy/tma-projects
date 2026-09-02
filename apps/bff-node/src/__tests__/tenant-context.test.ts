import { describe, expect, it } from 'vitest'
import {
  canDeposit, canWithdraw, currentTenant, currentTenantOrNull,
  isSiteOpen, runWithTenant, type TenantContext, type TenantStatus,
} from '../lib/tenant-context.js'

const self: TenantContext = {
  id: 1, code: 'betogo', database: 'betogo', status: 'active', selfOperated: true,
}
const other: TenantContext = {
  id: 2, code: 't002', database: 'betogo_t002', status: 'trial', selfOperated: false,
}

describe('租户上下文', () => {
  it('上下文外取租户直接抛错，不回落自营站', () => {
    expect(() => currentTenant()).toThrow(/没有租户上下文/)
    expect(currentTenantOrNull()).toBeNull()
  })

  it('同步调用链内可读到租户', () => {
    runWithTenant(self, () => {
      expect(currentTenant().database).toBe('betogo')
    })
  })

  // 业务代码几乎全是 async，上下文穿不透 await 就等于没用
  it('异步调用链内仍能读到租户', async () => {
    await runWithTenant(other, async () => {
      await new Promise((r) => setTimeout(r, 1))
      expect(currentTenant().code).toBe('t002')
      await Promise.resolve()
      expect(currentTenant().database).toBe('betogo_t002')
    })
  })

  // 定时任务是遍历租户串行跑的，相邻两次不能互相污染
  it('嵌套与相邻上下文互不污染', async () => {
    await runWithTenant(self, async () => {
      expect(currentTenant().id).toBe(1)
      await runWithTenant(other, async () => {
        expect(currentTenant().id).toBe(2)
      })
      expect(currentTenant().id).toBe(1)
    })
    expect(currentTenantOrNull()).toBeNull()
  })

  it('并发的两个租户上下文不串号', async () => {
    const seen: string[] = []
    await Promise.all([
      runWithTenant(self, async () => {
        await new Promise((r) => setTimeout(r, 5))
        seen.push(currentTenant().code)
      }),
      runWithTenant(other, async () => {
        await new Promise((r) => setTimeout(r, 1))
        seen.push(currentTenant().code)
      }),
    ])
    expect(seen.sort()).toEqual(['betogo', 't002'])
  })

  it('抛错后上下文正常释放', () => {
    expect(() => runWithTenant(self, () => { throw new Error('boom') })).toThrow('boom')
    expect(currentTenantOrNull()).toBeNull()
  })

  it('欠费降级各档位的充提与站点开关', () => {
    const at = (status: TenantStatus): TenantContext => ({ ...self, status })
    expect([canDeposit(at('active')), canWithdraw(at('active')), isSiteOpen(at('active'))]).toEqual([true, true, true])
    expect([canDeposit(at('withdraw_suspended')), canWithdraw(at('withdraw_suspended'))]).toEqual([true, false])
    expect([canDeposit(at('deposit_suspended')), canWithdraw(at('deposit_suspended'))]).toEqual([false, true])
    expect([canDeposit(at('suspended')), canWithdraw(at('suspended')), isSiteOpen(at('suspended'))]).toEqual([false, false, false])
    expect(isSiteOpen(at('closed'))).toBe(false)
  })
})
