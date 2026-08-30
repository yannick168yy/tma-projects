import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../config/env.js'

const { getRate } = vi.hoisted(() => ({ getRate: vi.fn() }))

vi.mock('../services/exchange-rate.service.js', () => ({ getRate }))

import { usdtRateMap } from '../services/marketing-bi.service.js'

describe('后台 USDT 等值汇率', () => {
  beforeEach(() => {
    getRate.mockReset()
    getRate.mockImplementation(async (_redis, from: string, to: string) => ({
      rate: to === 'USDT'
        ? (from === 'IDR' ? 1 / 287 / 58 : from === 'PHP' ? 1 / 58 : 1)
        : (from === 'IDR' ? 1 / 287 : from === 'USDT' || from === 'USDC' ? 58 : from === 'PHP' ? 1 : 10),
      fetchedAt: new Date().toISOString(),
      source: 'test',
    }))
  })

  it('IDR 不按 1:1 累加，并通过 PHP 汇率换算为 USDT', async () => {
    const rates = await usdtRateMap({} as never, { USDT_TO_PHP_RATE: 58 } as Env, ['IDR', 'USDT', 'PHP'])

    expect(800_000 * (rates.get('IDR') ?? 0)).toBeCloseTo(800_000 / 287 / 58, 6)
    expect(rates.get('USDT')).toBe(1)
    expect(rates.get('PHP')).toBeCloseTo(1 / 58, 10)
  })
})
