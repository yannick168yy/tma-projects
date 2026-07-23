import { describe, expect, it } from 'vitest'
import { resolveCryptoWithdrawGasFee, type CryptoWithdrawGate } from '../services/payment-channel.service.js'

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
