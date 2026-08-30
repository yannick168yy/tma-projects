import { describe, expect, it, vi } from 'vitest'
import type { Env } from '../config/env.js'
import { getRate } from '../services/exchange-rate.service.js'

describe('派生币种汇率', () => {
  it('通过基础汇率计算 IDR 到 USDT，不发起额外汇率请求', async () => {
    const redis = {
      get: vi.fn(async (key: string) => key === 'exchange_rate:USDT:PHP'
        ? JSON.stringify({ rate: 58, fetchedAt: '2026-01-01T00:00:00.000Z', source: 'test' })
        : null),
      setex: vi.fn(async () => 'OK'),
    }

    const result = await getRate(redis as never, 'idr', 'usdt', {
      USDT_TO_IDR_RATE: 16646,
      USDT_TO_PHP_RATE: 58,
    } as Env)

    expect(result.rate).toBeCloseTo(1 / 16646, 12)
    expect(result.source).toContain('derived:')
    expect(redis.setex).toHaveBeenCalledTimes(1)
  })
})
