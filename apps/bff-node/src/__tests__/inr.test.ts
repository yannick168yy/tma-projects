import { describe, expect, it } from 'vitest'
import { PHP_TO_INR_SEED, toInrRounded } from '../utils/inr.js'

describe('INR 活动金额初始化', () => {
  it('按固定参考汇率换算', () => {
    expect(PHP_TO_INR_SEED).toBe(1.53)
  })

  it('阶梯取整：≥1000 取百位，100~999 取十位，<100 取个位', () => {
    expect(toInrRounded(50000)).toBe(76500) // 76500 → 百位
    expect(toInrRounded(5000)).toBe(7700)   // 7650 → 百位
    expect(toInrRounded(1000)).toBe(1500)   // 1530 → 百位
    expect(toInrRounded(500)).toBe(770)     // 765 → 十位
    expect(toInrRounded(100)).toBe(150)     // 153 → 十位
    expect(toInrRounded(50)).toBe(77)       // 76.5 → 个位
    expect(toInrRounded(20)).toBe(31)       // 30.6 → 个位
  })

  it('正数最低为 1 INR，零金额保持为零', () => {
    expect(toInrRounded(0)).toBe(0)
    expect(toInrRounded(-5)).toBe(0)
    expect(toInrRounded(0.01)).toBe(1)
  })
})
