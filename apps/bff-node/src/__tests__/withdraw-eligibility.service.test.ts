import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'mysql2/promise'
import { MIN_CRYPTO_REAL_DEPOSIT, hasRealDepositForWithdraw } from '../services/withdraw-eligibility.service.js'

function poolWith(ok: number) {
  return {
    query: vi.fn(() => Promise.resolve([[{ ok }]])),
  } as unknown as Pool
}

describe('取款真实存款资格', () => {
  it('有合格存款时返回 true，并使用 5 USDT/USDC 门槛', async () => {
    const pool = poolWith(1)

    await expect(hasRealDepositForWithdraw(pool, 'BG-10001')).resolves.toBe(true)

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("UPPER(currency) NOT IN ('USDT', 'USDC')"),
      ['BG-10001', MIN_CRYPTO_REAL_DEPOSIT],
    )
  })

  it('没有合格存款时返回 false', async () => {
    await expect(hasRealDepositForWithdraw(poolWith(0), 'BG-10001')).resolves.toBe(false)
  })
})
