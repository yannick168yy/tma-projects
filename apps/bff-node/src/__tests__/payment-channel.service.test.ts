import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMysqlPool } from '../clients/mysql.client.js'
import {
  listAvailableChannels,
  resolveChannel,
  resolveCryptoWithdrawGasFee,
  type CryptoWithdrawGate,
} from '../services/payment-channel.service.js'

vi.mock('../clients/mysql.client.js', () => ({ getMysqlPool: vi.fn() }))

const query = vi.fn()

beforeEach(() => {
  query.mockReset()
  vi.mocked(getMysqlPool).mockReturnValue({ query } as never)
})

const gate = (overrides: Partial<CryptoWithdrawGate> = {}): CryptoWithdrawGate => ({
  exists: true,
  enabled: true,
  gasFee: 1.5,
  gasDiscountThreshold: 50,
  gasDiscountFee: 1.2,
  ...overrides,
})

describe('虚拟币提现 gas 优惠档', () => {
  it('取款金额达到门槛时使用优惠 gas', () => {
    expect(resolveCryptoWithdrawGasFee(gate(), 50)).toBe(1.2)
    expect(resolveCryptoWithdrawGasFee(gate(), 50.01)).toBe(1.2)
  })

  it('取款金额低于门槛时使用普通 gas', () => {
    expect(resolveCryptoWithdrawGasFee(gate(), 10)).toBe(1.5)
  })

  it('优惠档未完整配置时使用普通 gas', () => {
    expect(resolveCryptoWithdrawGasFee(gate({ gasDiscountFee: null }), 100)).toBe(1.5)
    expect(resolveCryptoWithdrawGasFee(gate({ gasDiscountThreshold: null }), 100)).toBe(1.5)
  })
})

describe('法币支付商独立展示与路由', () => {
  it('同名渠道按支付商分别返回', async () => {
    query.mockResolvedValueOnce([[
      { name: 'dana', provider: 'unispay', label: 'DANA - UnisPay', sort_order: 202, amount_min: '1000', amount_max: '20000000' },
      { name: 'dana', provider: 'wzpay', label: 'DANA - WZPAY', sort_order: 231, amount_min: null, amount_max: null },
    ]])

    await expect(listAvailableChannels({} as never, 'deposit', 'IDR')).resolves.toEqual([
      { name: 'dana', provider: 'unispay', label: 'DANA - UnisPay', minAmount: 1000, maxAmount: 20000000 },
      { name: 'dana', provider: 'wzpay', label: 'DANA - WZPAY', minAmount: null, maxAmount: null },
    ])
  })

  it('客户端指定支付商后只匹配该支付商', async () => {
    query.mockResolvedValueOnce([[{ provider: 'wzpay', weight: 100 }]])

    await expect(resolveChannel({} as never, 'dana', 'deposit', 50000, 'IDR', 'wzpay')).resolves.toBe('wzpay')
    expect(query.mock.calls[0]?.[1]).toEqual(['dana', 'wzpay', 'wzpay', 'IDR', 'deposit', 50000, 50000])
  })
})
