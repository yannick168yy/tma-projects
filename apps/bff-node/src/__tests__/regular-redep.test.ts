import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'mysql2/promise'
import { createRegularRedepClaim } from '../services/regular-redep.service.js'

const configRows = [
  { config_key: 'enabled', config_value: '1' },
  { config_key: 'tiers', config_value: JSON.stringify({ PHP: [
    { depositAmount: 500, bonusAmount: 50, turnoverX: 25 }, { depositAmount: 1000, bonusAmount: 120, turnoverX: 28 },
    { depositAmount: 3000, bonusAmount: 450, turnoverX: 32 },
  ] }) },
  { config_key: 'turnover_x', config_value: '3' },
  { config_key: 'turnover_days', config_value: '30' },
  { config_key: 'claim_hours', config_value: '24' },
  { config_key: 'daily_max_claims', config_value: '3' },
  { config_key: 'daily_bonus_caps', config_value: JSON.stringify({ PHP: 1200 }) },
  { config_key: 'stack_with_limited', config_value: '0' },
]

function poolWithLimited(limited: boolean) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("promo_id='redep_regular'")) return [configRows]
    if (sql.includes('FROM bg_deposit_order')) return [[{ ok: 1 }]]
    if (sql.includes('FROM bg_redep_offer')) return [limited ? [{ ok: 1 }] : []]
    if (sql.includes('FROM bg_regular_redep_claim')) return [[{ cnt: 0, bonus: 0 }]]
    throw new Error(`未处理的 SQL: ${sql}`)
  })
  const execute = vi.fn(async (_sql: string, _params: unknown[]) => [{ affectedRows: 1 }])
  return { pool: { query, execute } as unknown as Pool, execute }
}

describe('常规复充资格生成', () => {
  it('按单笔充值命中最高档并生成待领取资格', async () => {
    const { pool, execute } = poolWithLimited(false)
    await createRegularRedepClaim(pool, 'BG-10001', 'DEP-2', 3200, 'PHP')

    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0][1]).toEqual(['DEP-2', 'BG-10001', 'PHP', 3200, 450, 32, 30, 24])
  })

  it('同一订单已命中限时复充时不再生成常规赠金', async () => {
    const { pool, execute } = poolWithLimited(true)
    await createRegularRedepClaim(pool, 'BG-10001', 'DEP-2', 3200, 'PHP')

    expect(execute).not.toHaveBeenCalled()
  })
})
