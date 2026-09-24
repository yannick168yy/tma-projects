import { describe, expect, it, vi } from 'vitest'
import type { Env } from '../config/env.js'
import { getRate } from '../services/exchange-rate.service.js'

const mkRedis = () => ({
  get: vi.fn(async () => null),
  setex: vi.fn(async () => 'OK'),
})

describe('INR 汇率', () => {
  it('INR 到 USDT 走兜底基础汇率，不会无限递归', async () => {
    const redis = mkRedis()

    const result = await getRate(redis as never, 'inr', 'usdt', {
      USDT_TO_INR_RATE: 88,
      USDT_TO_PHP_RATE: 58,
    } as Env)

    expect(result.rate).toBeCloseTo(1 / 88, 12)
  })

  it('INR 到 PHP 经 USDT 基准换算', async () => {
    // 喂缓存，避免 USDT→PHP 真去打 CoinGecko
    const redis = {
      get: vi.fn(async (key: string) => key === 'exchange_rate:USDT:PHP'
        ? JSON.stringify({ rate: 58, fetchedAt: '2026-01-01T00:00:00.000Z', source: 'test' })
        : null),
      setex: vi.fn(async () => 'OK'),
    }

    const result = await getRate(redis as never, 'INR', 'PHP', {
      USDT_TO_INR_RATE: 88,
      USDT_TO_PHP_RATE: 58,
    } as Env)

    expect(result.rate).toBeCloseTo(58 / 88, 12)
  })

  // 递归防线：没有基础汇率路径的币种必须立刻报错，而不是自己调自己把栈爆掉
  it('未配置基础汇率的币种直接抛错', async () => {
    const redis = mkRedis()

    await expect(getRate(redis as never, 'VND', 'USDT', {
      USDT_TO_INR_RATE: 88,
      USDT_TO_PHP_RATE: 58,
    } as Env)).rejects.toThrow(/No exchange rate path for VND/)
  })
})
